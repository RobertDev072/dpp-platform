"use client";

import Button from "@/components/ui/Button";

// Client-side paginering voor de adminlijsten; verschijnt pas bij meer dan één pagina.
export default function ListPagination({ page, totalPages, totalItems, singular, plural, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <p className="text-sm text-slate-500">
        Pagina {page} van {totalPages} ({totalItems} {totalItems === 1 ? singular : plural})
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="disabled:cursor-not-allowed disabled:opacity-50"
        >
          Vorige
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="disabled:cursor-not-allowed disabled:opacity-50"
        >
          Volgende
        </Button>
      </div>
    </div>
  );
}
