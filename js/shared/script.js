/**
 * Portfolio Interactive Scripts
 * Author: Rangga Ganupranowo Hadad
 * Aspiring Cybersecurity Engineer
 */

document.addEventListener('DOMContentLoaded', () => {
  initNetworkCanvas();
  initMobileNav();
  initScrollSpy();
  initContactForm();
  initTerminalInteractions();
});

/* --------------------------------------------------------------------------
   1. Cyber Network Canvas Animation
   Simulates connected network topology nodes & data telemetry lines
   -------------------------------------------------------------------------- */
function initNetworkCanvas() {
  const canvas = document.getElementById('cyber-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  // Resize handler
  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    initNodes();
  });

  const nodeCount = Math.min(Math.floor((width * height) / 18000), 70);
  let nodes = [];

  class NetworkNode {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.45;
      this.vy = (Math.random() - 0.5) * 0.45;
      this.radius = Math.random() * 2 + 1.2;
      this.isGateway = Math.random() < 0.15; // special accent node
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      if (this.x < 0 || this.x > width) this.vx *= -1;
      if (this.y < 0 || this.y > height) this.vy *= -1;
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.isGateway ? '#00f5d4' : '#38bdf8';
      ctx.fill();
    }
  }

  function initNodes() {
    nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push(new NetworkNode());
    }
  }

  initNodes();

  const maxDistance = 140;

  function render() {
    ctx.clearRect(0, 0, width, height);

    // Draw connection lines
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);

        if (dist < maxDistance) {
          const alpha = (1 - dist / maxDistance) * 0.22;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(0, 245, 212, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Update and draw nodes
    nodes.forEach((node) => {
      node.update();
      node.draw();
    });

    requestAnimationFrame(render);
  }

  render();
}

/* --------------------------------------------------------------------------
   2. Mobile Navigation Toggle
   -------------------------------------------------------------------------- */
function initMobileNav() {
  const toggleBtn = document.getElementById('nav-toggle');
  const navMenu = document.getElementById('nav-menu');
  if (!toggleBtn || !navMenu) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  // Close nav on click of any nav link
  const links = navMenu.querySelectorAll('.nav-link');
  links.forEach((link) => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    });
  });

  // Close nav when clicking outside
  document.addEventListener('click', (e) => {
    if (!navMenu.contains(e.target) && !toggleBtn.contains(e.target)) {
      navMenu.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

/* --------------------------------------------------------------------------
   3. Active Section Navigation Indicator (ScrollSpy)
   -------------------------------------------------------------------------- */
function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  if (!sections.length || !navLinks.length) return;

  function updateActiveLink() {
    let currentId = '';
    const scrollY = window.pageYOffset;

    sections.forEach((section) => {
      const sectionTop = section.offsetTop - 120;
      const sectionHeight = section.offsetHeight;

      if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
        currentId = section.getAttribute('id');
      }
    });

    navLinks.forEach((link) => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (href === `#${currentId}`) {
        link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', updateActiveLink, { passive: true });
  updateActiveLink();
}

/* --------------------------------------------------------------------------
   4. Contact Form Handler (Client-side feedback)
   -------------------------------------------------------------------------- */
function initContactForm() {
  const form = document.getElementById('contact-form');
  const statusMsg = document.getElementById('form-status');
  const submitBtn = document.getElementById('form-submit-btn');

  if (!form || !statusMsg) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const message = form.message.value.trim();

    if (!name || !email || !message) {
      statusMsg.className = 'form-status-msg error';
      statusMsg.textContent = '[ERR] Please fill in all required fields.';
      return;
    }

    // Disable button temporarily to prevent spamming
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
    }

    statusMsg.className = 'form-status-msg';
    statusMsg.textContent = '[TRANSMITTING] Routing packet to inbox...';

    setTimeout(() => {
      statusMsg.className = 'form-status-msg success';
      statusMsg.textContent = `[ACK] Message received. Thank you, ${name}! I will follow up shortly.`;
      form.reset();

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
      }

      setTimeout(() => {
        statusMsg.textContent = '';
      }, 7000);
    }, 900);
  });
}

/* --------------------------------------------------------------------------
   5. Terminal Interactive Commands
   -------------------------------------------------------------------------- */
function initTerminalInteractions() {
  const terminalBody = document.getElementById('terminal-body');
  if (!terminalBody) return;

  // Append a live timestamp log line
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

  const logLine = document.createElement('p');
  logLine.className = 'term-line';
  logLine.innerHTML = `<span class="term-prompt">SYS_LOG:</span> <span class="term-output" style="margin:0;color:#64748b;">Telemetry active as of [${timestamp} UTC]</span>`;
  terminalBody.appendChild(logLine);
}
