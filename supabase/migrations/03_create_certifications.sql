-- =====================================================================
-- Migration 03: Certifications Table + Storage Bucket (admin-only writes)
-- Target: Supabase PostgreSQL (SQL Editor)
--
-- SEBELUM MENJALANKAN:
--   Ganti placeholder UID admin di langkah 1 (satu-satunya di file ini) dengan UID akun admin
--   dari Supabase Dashboard > Authentication > Users. Jika placeholder belum diganti
--   atau UID tidak ada di auth.users, seluruh migrasi dibatalkan (satu transaksi).
--
-- Model keamanan:
--   - Admin = satu akun, dicocokkan lewat auth.uid(). Tidak memakai email, user_metadata,
--     profiles.role, atau status "sudah login" (pendaftaran publik tetap terbuka).
--   - Tabel: baca semua orang (anon + authenticated); tulis hanya admin, ditegakkan oleh RLS.
--   - Bucket: file dibuka lewat URL publik; daftar file, upload, ganti, hapus hanya admin.
-- =====================================================================

BEGIN;

-- 1. Penentu admin: satu-satunya tempat UID admin ditulis
CREATE OR REPLACE FUNCTION public.is_certifications_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(auth.uid() = 'GANTI_DENGAN_UID_ADMIN'::uuid, false);
$$;

COMMENT ON FUNCTION public.is_certifications_admin() IS
  'True hanya untuk akun admin sertifikat (dicocokkan lewat auth.uid()). Dipakai oleh RLS tabel certifications dan bucket certificates.';

-- Fungsi ini hanya membandingkan UID pemanggil; dipanggil halaman admin lewat RPC
-- sebagai pengecekan kenyamanan. Keamanan sebenarnya tetap di kebijakan RLS di bawah.
REVOKE ALL ON FUNCTION public.is_certifications_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_certifications_admin() TO authenticated, service_role;

-- Pastikan UID admin benar-benar akun yang ada (cegah salah ketik)
DO $$
DECLARE
  admin_count integer;
BEGIN
  SELECT count(*) INTO admin_count
  FROM auth.users u
  WHERE u.id = (
    SELECT substring(pg_get_functiondef('public.is_certifications_admin()'::regprocedure)
      FROM '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')::uuid
  );

  IF admin_count <> 1 THEN
    RAISE EXCEPTION 'UID admin tidak ditemukan di auth.users. Periksa nilai di is_certifications_admin().';
  END IF;
END;
$$;

-- 2. Tabel certifications
CREATE TABLE IF NOT EXISTS public.certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  issuer text NOT NULL CHECK (char_length(btrim(issuer)) BETWEEN 1 AND 200),
  issued_date date NOT NULL,
  credential_id text CHECK (credential_id IS NULL OR char_length(credential_id) BETWEEN 1 AND 200),
  -- Hanya https; frontend juga memvalidasi sebelum menyimpan dan sebelum merender link
  credential_url text CHECK (
    credential_url IS NULL
    OR (credential_url ~ '^https://[^\s/?#]+' AND char_length(credential_url) <= 2048)
  ),
  -- Nama objek di bucket "certificates" (tanpa folder, tanpa "..")
  file_path text CHECK (
    file_path IS NULL OR file_path ~ '^[A-Za-z0-9_-]{1,100}\.(png|jpg|jpeg|pdf)$'
  ),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -100000 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.certifications IS 'Sertifikat & kursus yang tampil di halaman utama. Tulis hanya oleh admin (RLS).';
COMMENT ON COLUMN public.certifications.file_path IS 'Nama objek di bucket Storage "certificates" (PNG, JPEG, atau PDF).';
COMMENT ON COLUMN public.certifications.sort_order IS 'Urutan tampil (kecil lebih dulu), lalu issued_date terbaru.';

CREATE INDEX IF NOT EXISTS certifications_display_order_idx
  ON public.certifications (sort_order ASC, issued_date DESC);

-- 3. Hak akses tabel: seminimal mungkin. RLS tetap menyaring baris.
--    anon hanya boleh membaca; authenticated boleh mencoba menulis kolom tertentu,
--    tetapi kebijakan RLS menolak semua akun selain admin.
REVOKE ALL ON TABLE public.certifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.certifications TO anon, authenticated;
GRANT INSERT (title, issuer, issued_date, credential_id, credential_url, file_path, sort_order)
  ON TABLE public.certifications TO authenticated;
GRANT UPDATE (title, issuer, issued_date, credential_id, credential_url, file_path, sort_order)
  ON TABLE public.certifications TO authenticated;
GRANT DELETE ON TABLE public.certifications TO authenticated;
GRANT ALL ON TABLE public.certifications TO service_role;

-- 4. Row Level Security
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Certifications are viewable by everyone" ON public.certifications;
CREATE POLICY "Certifications are viewable by everyone"
  ON public.certifications
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Only admin can insert certifications" ON public.certifications;
CREATE POLICY "Only admin can insert certifications"
  ON public.certifications
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_certifications_admin()));

DROP POLICY IF EXISTS "Only admin can update certifications" ON public.certifications;
CREATE POLICY "Only admin can update certifications"
  ON public.certifications
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_certifications_admin()))
  WITH CHECK ((SELECT public.is_certifications_admin()));

DROP POLICY IF EXISTS "Only admin can delete certifications" ON public.certifications;
CREATE POLICY "Only admin can delete certifications"
  ON public.certifications
  FOR DELETE
  TO authenticated
  USING ((SELECT public.is_certifications_admin()));

-- 5. Bucket Storage "certificates": publik untuk dibaca, 5 MB, PNG/JPEG/PDF
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certificates',
  'certificates',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 6. Kebijakan storage.objects untuk bucket ini (RLS storage.objects sudah aktif di Supabase)
--    Tidak ada SELECT untuk anon/non-admin: daftar file tidak bisa dilihat lewat API.
--    File tetap bisa dibuka lewat URL publik (/storage/v1/object/public/certificates/<nama>),
--    karena unduhan dari bucket public tidak melewati RLS. SELECT admin juga dibutuhkan
--    Storage API saat admin mengganti (upsert) dan menghapus file.
DROP POLICY IF EXISTS "certificates: public read" ON storage.objects;
DROP POLICY IF EXISTS "certificates: admin read" ON storage.objects;
CREATE POLICY "certificates: admin read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'certificates' AND (SELECT public.is_certifications_admin()));

DROP POLICY IF EXISTS "certificates: admin upload" ON storage.objects;
CREATE POLICY "certificates: admin upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'certificates' AND (SELECT public.is_certifications_admin()));

DROP POLICY IF EXISTS "certificates: admin update" ON storage.objects;
CREATE POLICY "certificates: admin update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'certificates' AND (SELECT public.is_certifications_admin()))
  WITH CHECK (bucket_id = 'certificates' AND (SELECT public.is_certifications_admin()));

DROP POLICY IF EXISTS "certificates: admin delete" ON storage.objects;
CREATE POLICY "certificates: admin delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'certificates' AND (SELECT public.is_certifications_admin()));

COMMIT;
