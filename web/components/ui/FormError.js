"use client";

// Paginabrede rode foutbox voor formErrors en niet-veldgebonden meldingen.
// Accepteert een string of een (api.js-)Error met .formErrors / .message.
export default function FormError({ error }) {
  if (!error) {
    return null;
  }

  let messages;
  if (typeof error === "string") {
    messages = [error];
  } else {
    const formErrors = Array.isArray(error.formErrors) ? error.formErrors.filter(Boolean) : [];
    messages = formErrors.length > 0 ? formErrors : error.message ? [error.message] : [];
  }

  if (messages.length === 0) {
    return null;
  }

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {messages.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
    </div>
  );
}
