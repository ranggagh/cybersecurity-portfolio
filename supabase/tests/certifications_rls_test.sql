-- =====================================================================
-- Uji RLS: tabel public.certifications & bucket Storage "certificates"
-- Jalankan di Supabase SQL Editor SETELAH migrasi 03. Tidak ada yang tersimpan:
-- semua perubahan terjadi di dalam blok yang selalu dibatalkan (rollback) di akhir.
--
-- Cara kerja: mensimulasikan peran anon / authenticated beserta klaim JWT (sub) seperti
-- yang dilakukan PostgREST, lalu mencoba SELECT/INSERT/UPDATE/DELETE.
--   - non-admin = UID acak (pendaftar publik mana pun)
--   - admin     = akun di auth.users yang dikenali is_certifications_admin()
-- Hasil: satu tabel dengan kolom status PASS / FAIL / CEK. Semua harus PASS.
-- CEK = ditolak dengan error selain RLS/izin; baca kolom outcome.
--
-- Catatan: ini menguji kebijakan di database. Jalur Storage API (upload file sungguhan,
-- daftar file, dan URL publik file) diuji oleh supabase/tests/rls-certifications.mjs.
-- URL publik tidak bisa diuji dari SQL karena dilayani server Storage tanpa melewati RLS.
-- =====================================================================

-- Jalankan satu pernyataan SQL sebagai peran tertentu; kembalikan ringkasan hasilnya
CREATE OR REPLACE FUNCTION pg_temp.try_as(p_role text, p_uid uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n bigint;
  outcome text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', p_role, true);
    PERFORM set_config('role', p_role, true);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    outcome := 'OK rows=' || n;
  EXCEPTION WHEN OTHERS THEN
    outcome := 'ERR ' || SQLSTATE || ': ' || SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RETURN outcome;
END;
$$;

-- denied: lolos jika error izin/RLS (42501) atau tidak ada baris yang terkena
-- allowed: lolos jika tepat satu baris terkena
-- violation: lolos jika ditolak CHECK constraint (23514)
CREATE OR REPLACE FUNCTION pg_temp.judge(p_actor text, p_action text, p_expected text, p_outcome text)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'actor', p_actor,
    'action', p_action,
    'expected', p_expected,
    'outcome', p_outcome,
    'status', CASE
      WHEN p_expected = 'denied' AND (p_outcome LIKE 'ERR 42501%' OR p_outcome = 'OK rows=0') THEN 'PASS'
      WHEN p_expected = 'denied' AND p_outcome LIKE 'OK rows=%' THEN 'FAIL'
      WHEN p_expected = 'allowed' AND p_outcome = 'OK rows=1' THEN 'PASS'
      WHEN p_expected = 'allowed' AND p_outcome LIKE 'OK rows=%' THEN 'CEK'
      WHEN p_expected = 'violation' AND p_outcome LIKE 'ERR 23514%' THEN 'PASS'
      WHEN p_expected = 'violation' AND p_outcome LIKE 'OK rows=%' THEN 'FAIL'
      WHEN p_expected = 'allowed' THEN 'FAIL'
      ELSE 'CEK'
    END
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.run_certifications_rls_test()
RETURNS TABLE (no int, status text, actor text, action text, expected text, outcome text)
LANGUAGE plpgsql
AS $$
DECLARE
  results jsonb := '[]'::jsonb;
  admin_uid uuid;
  admin_count int := 0;
  non_admin uuid := gen_random_uuid();
  tag text := 'RLS_TEST_' || replace(gen_random_uuid()::text, '-', '');
  cert_id uuid;
  obj_name text := 'rls-test-' || replace(gen_random_uuid()::text, '-', '') || '.png';
  obj_outcome text;
  is_admin_result boolean;
  u record;
BEGIN
  BEGIN
    -- Cari akun admin: user di auth.users yang dikenali is_certifications_admin()
    FOR u IN SELECT id FROM auth.users LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', u.id::text, true);
      IF public.is_certifications_admin() THEN
        admin_uid := u.id;
        admin_count := admin_count + 1;
      END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);

    results := results || pg_temp.judge('setup', 'jumlah akun admin di auth.users (harus 1)', 'allowed',
      'OK rows=' || admin_count);

    -- ---------- Admin: buat data uji (sekaligus menguji izin admin) ----------
    results := results || pg_temp.judge('admin', 'INSERT certifications', 'allowed',
      pg_temp.try_as('authenticated', admin_uid, format(
        'INSERT INTO public.certifications (title, issuer, issued_date) VALUES (%L, %L, current_date)', tag, 'RLS Test')));

    SELECT c.id INTO cert_id FROM public.certifications c WHERE c.title = tag;
    IF cert_id IS NULL THEN
      -- Admin gagal insert; tetap buat baris uji (sebagai pemilik tabel) agar tes non-admin berjalan
      INSERT INTO public.certifications (title, issuer, issued_date)
      VALUES (tag, 'RLS Test', current_date)
      RETURNING id INTO cert_id;
    END IF;

    obj_outcome := pg_temp.try_as('authenticated', admin_uid, format(
      'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'certificates', obj_name));
    results := results || pg_temp.judge('admin', 'INSERT storage.objects (upload)', 'allowed', obj_outcome);

    -- ---------- anon (pengunjung tanpa login) ----------
    results := results || pg_temp.judge('anon', 'SELECT certifications (baca publik)', 'allowed',
      pg_temp.try_as('anon', NULL, format('SELECT 1 FROM public.certifications WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('anon', 'INSERT certifications', 'denied',
      pg_temp.try_as('anon', NULL,
        'INSERT INTO public.certifications (title, issuer, issued_date) VALUES (''x'', ''x'', current_date)'));

    results := results || pg_temp.judge('anon', 'UPDATE certifications', 'denied',
      pg_temp.try_as('anon', NULL, format(
        'UPDATE public.certifications SET title = ''HACKED'' WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('anon', 'DELETE certifications', 'denied',
      pg_temp.try_as('anon', NULL, format('DELETE FROM public.certifications WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('anon', 'INSERT storage.objects (upload)', 'denied',
      pg_temp.try_as('anon', NULL, format(
        'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'certificates', 'anon-' || obj_name)));

    -- ---------- authenticated non-admin (pendaftar publik) ----------
    results := results || pg_temp.judge('non-admin', 'SELECT certifications (baca publik)', 'allowed',
      pg_temp.try_as('authenticated', non_admin, format('SELECT 1 FROM public.certifications WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('non-admin', 'INSERT certifications', 'denied',
      pg_temp.try_as('authenticated', non_admin,
        'INSERT INTO public.certifications (title, issuer, issued_date) VALUES (''x'', ''x'', current_date)'));

    results := results || pg_temp.judge('non-admin', 'UPDATE certifications', 'denied',
      pg_temp.try_as('authenticated', non_admin, format(
        'UPDATE public.certifications SET title = ''HACKED'' WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('non-admin', 'UPDATE certifications (semua baris)', 'denied',
      pg_temp.try_as('authenticated', non_admin, 'UPDATE public.certifications SET sort_order = sort_order'));

    results := results || pg_temp.judge('non-admin', 'DELETE certifications', 'denied',
      pg_temp.try_as('authenticated', non_admin, format('DELETE FROM public.certifications WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('non-admin', 'INSERT storage.objects (upload)', 'denied',
      pg_temp.try_as('authenticated', non_admin, format(
        'INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'certificates', 'user-' || obj_name)));

    -- Tanpa objek uji (upload admin gagal), "0 baris" tidak membuktikan apa pun → CEK
    IF obj_outcome = 'OK rows=1' THEN
      results := results || pg_temp.judge('non-admin', 'UPDATE storage.objects (timpa file)', 'denied',
        pg_temp.try_as('authenticated', non_admin, format(
          'UPDATE storage.objects SET metadata = ''{"hacked": true}''::jsonb WHERE bucket_id = %L AND name = %L',
          'certificates', obj_name)));

      results := results || pg_temp.judge('non-admin', 'DELETE storage.objects', 'denied',
        pg_temp.try_as('authenticated', non_admin, format(
          'DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'certificates', obj_name)));

      -- Daftar file: objek uji ADA, jadi 0 baris berarti benar-benar disembunyikan RLS
      results := results || pg_temp.judge('anon', 'SELECT storage.objects (lihat daftar file)', 'denied',
        pg_temp.try_as('anon', NULL, format(
          'SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L', 'certificates', obj_name)));

      results := results || pg_temp.judge('non-admin', 'SELECT storage.objects (lihat daftar file)', 'denied',
        pg_temp.try_as('authenticated', non_admin, format(
          'SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L', 'certificates', obj_name)));

      results := results || pg_temp.judge('admin', 'SELECT storage.objects (lihat daftar file)', 'allowed',
        pg_temp.try_as('authenticated', admin_uid, format(
          'SELECT 1 FROM storage.objects WHERE bucket_id = %L AND name = %L', 'certificates', obj_name)));
    ELSE
      results := results || jsonb_build_object(
        'actor', 'anon/non-admin', 'action', 'SELECT/UPDATE/DELETE storage.objects', 'expected', 'denied',
        'outcome', 'tidak diuji: objek uji gagal dibuat (lihat baris upload admin)', 'status', 'CEK');
    END IF;

    -- Pengecekan kenyamanan halaman admin (RPC) harus false untuk non-admin
    PERFORM set_config('request.jwt.claims', json_build_object('sub', non_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', non_admin::text, true);
    PERFORM set_config('role', 'authenticated', true);
    is_admin_result := public.is_certifications_admin();
    PERFORM set_config('role', 'none', true);
    results := results || jsonb_build_object(
      'actor', 'non-admin', 'action', 'RPC is_certifications_admin()', 'expected', 'false',
      'outcome', 'returned ' || is_admin_result,
      'status', CASE WHEN is_admin_result = false THEN 'PASS' ELSE 'FAIL' END);

    -- Pastikan data uji tidak berubah oleh percobaan non-admin/anon
    results := results || jsonb_build_object(
      'actor', 'check', 'action', 'baris uji utuh setelah percobaan non-admin', 'expected', 'title tidak berubah',
      'outcome', coalesce((SELECT c.title FROM public.certifications c WHERE c.id = cert_id), '(baris hilang)'),
      'status', CASE WHEN EXISTS (SELECT 1 FROM public.certifications c WHERE c.id = cert_id AND c.title = tag)
                     THEN 'PASS' ELSE 'FAIL' END);

    -- ---------- Admin: ubah, constraint, hapus ----------
    results := results || pg_temp.judge('admin', 'UPDATE certifications', 'allowed',
      pg_temp.try_as('authenticated', admin_uid, format(
        'UPDATE public.certifications SET sort_order = 7 WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('admin', 'UPDATE credential_url = javascript:...', 'violation',
      pg_temp.try_as('authenticated', admin_uid, format(
        'UPDATE public.certifications SET credential_url = ''javascript:alert(1)'' WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('admin', 'UPDATE credential_url = http://...', 'violation',
      pg_temp.try_as('authenticated', admin_uid, format(
        'UPDATE public.certifications SET credential_url = ''http://example.com'' WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('admin', 'UPDATE file_path = ../x.pdf', 'violation',
      pg_temp.try_as('authenticated', admin_uid, format(
        'UPDATE public.certifications SET file_path = ''../x.pdf'' WHERE id = %L', cert_id)));

    results := results || pg_temp.judge('admin', 'DELETE certifications', 'allowed',
      pg_temp.try_as('authenticated', admin_uid, format('DELETE FROM public.certifications WHERE id = %L', cert_id)));

    IF obj_outcome = 'OK rows=1' THEN
      results := results || pg_temp.judge('admin', 'UPDATE storage.objects (ganti file)', 'allowed',
        pg_temp.try_as('authenticated', admin_uid, format(
          'UPDATE storage.objects SET metadata = ''{"replaced": true}''::jsonb WHERE bucket_id = %L AND name = %L',
          'certificates', obj_name)));

      -- Proyek Supabase baru bisa memasang trigger yang melarang DELETE langsung dari SQL
      -- (penghapusan wajib lewat Storage API). Itu bukan penolakan RLS → CEK, uji lewat skrip Node.
      obj_outcome := pg_temp.try_as('authenticated', admin_uid, format(
        'DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'certificates', obj_name));
      results := results || CASE
        WHEN obj_outcome ILIKE '%direct deletion%' THEN jsonb_build_object(
          'actor', 'admin', 'action', 'DELETE storage.objects (hapus file)', 'expected', 'allowed',
          'outcome', obj_outcome || ' → uji lewat rls-certifications.mjs (ADMIN_EMAIL)', 'status', 'CEK')
        ELSE pg_temp.judge('admin', 'DELETE storage.objects (hapus file)', 'allowed', obj_outcome)
      END;
    END IF;

    -- Batalkan semua perubahan di atas
    RAISE EXCEPTION USING ERRCODE = 'P0R01', MESSAGE = 'rollback test data';
  EXCEPTION WHEN SQLSTATE 'P0R01' THEN
    NULL;
  END;

  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  RETURN QUERY
  SELECT (r.ordinality)::int, r.value->>'status', r.value->>'actor', r.value->>'action',
         r.value->>'expected', r.value->>'outcome'
  FROM jsonb_array_elements(results) WITH ORDINALITY AS r(value, ordinality)
  ORDER BY r.ordinality;
END;
$$;

SELECT * FROM pg_temp.run_certifications_rls_test();
