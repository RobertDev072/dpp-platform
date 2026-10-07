"use client";

import { useState } from "react";
import ActionButton from "@/components/ui/ActionButton";
import { PrinterIcon } from "@/components/ui/icons";
import PrintDialog, { loaderForIds } from "@/components/print/PrintDialog";

export default function PrintLabelsButton({ productIds, size, label = "Printen met profiel" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton size={size} icon={<PrinterIcon size={size === "sm" ? 14 : 18} />} onClick={() => setOpen(true)} title="Labels printen via een printprofiel">
        {label}
      </ActionButton>
      {open && <PrintDialog count={productIds.length} loadItems={loaderForIds(productIds)} onClose={() => setOpen(false)} />}
    </>
  );
}
