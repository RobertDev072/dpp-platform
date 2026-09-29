"use client";

import { useState } from "react";

const CONTACT_EMAIL = "rb085@icloud.com";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const subject = encodeURIComponent(`Contactaanvraag VeriPasso van ${name || "website"}`);
    const body = encodeURIComponent(`${message}\n\nNaam: ${name}\nE-mail: ${email}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="contact-name" className="block text-xs font-medium text-slate-600">
          Naam
        </label>
        <input
          id="contact-name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1476FF] focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="contact-email" className="block text-xs font-medium text-slate-600">
          E-mailadres
        </label>
        <input
          id="contact-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1476FF] focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="contact-message" className="block text-xs font-medium text-slate-600">
          Bericht
        </label>
        <textarea
          id="contact-message"
          required
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#1476FF] focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="w-full rounded-lg bg-[#1476FF] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0f5fd1]"
      >
        Verstuur bericht
      </button>
    </form>
  );
}
