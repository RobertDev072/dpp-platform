"use client";

import { useState } from "react";

/**
 * Kleine formulier-hook met veldvalidatie en server-fouten (Zod flatten-vorm).
 *
 * useForm({ initial, validators })
 *   validators = { veldnaam: (value, values) => "Nederlandse foutmelding" | null }
 */
export function useForm({ initial, validators = {} }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});

  function runValidator(name, value, allValues) {
    const validator = validators[name];
    if (!validator) {
      return null;
    }
    return validator(value, allValues) || null;
  }

  function setValue(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Tijdens het typen verdwijnt de foutmelding van dat veld meteen.
    setErrors((prev) => {
      if (!prev[name]) {
        return prev;
      }
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function onBlur(name) {
    const message = runValidator(name, values[name], values);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) {
        next[name] = message;
      } else {
        delete next[name];
      }
      return next;
    });
  }

  function validateAll() {
    const next = {};
    for (const name of Object.keys(validators)) {
      const message = runValidator(name, values[name], values);
      if (message) {
        next[name] = message;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function applyServerErrors(err) {
    const fieldErrors = err && err.fieldErrors;
    if (!fieldErrors || typeof fieldErrors !== "object") {
      return false;
    }

    const mapped = {};
    for (const [name, messages] of Object.entries(fieldErrors)) {
      const message = Array.isArray(messages) ? messages[0] : messages;
      if (message) {
        mapped[name] = message;
      }
    }

    if (Object.keys(mapped).length === 0) {
      return false;
    }

    // Serverfouten winnen van eventuele client-fouten.
    setErrors((prev) => ({ ...prev, ...mapped }));
    return true;
  }

  function reset() {
    setValues(initial);
    setErrors({});
  }

  return { values, setValue, errors, onBlur, validateAll, applyServerErrors, reset };
}
