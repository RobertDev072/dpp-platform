"use client";

import Field from "@/components/ui/Field";

// Numeriek invoerveld op basis van het standaard Field: zelfde foutafhandeling en
// styling, maar met numeriek toetsenbord en type="number". min/max/step zijn
// doorgeefbaar per veld (bijv. min=0, max=100 voor percentages).
export default function NumberField({ step = "any", inputMode = "decimal", ...props }) {
  return <Field type="number" step={step} inputMode={inputMode} {...props} />;
}
