"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 50;

export default function QrCodesPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");

    api
      .get(`/api/products?status=published&pageSize=${PAGE_SIZE}&sort=name&page=${page}`)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items || []);
          setTotal(data.total || 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">QR-codes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Download de QR-codes van je gepubliceerde producten voor op verpakkingen en labels.
        </p>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nog geen gepubliceerde producten"
            description="Publiceer eerst een product; de bijbehorende QR-code verschijnt dan hier."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((product) => (
              <Card key={product.id} className="flex items-start gap-4">
                <img
                  src={`/api/products/${product.id}/qr.png`}
                  alt={`QR-code voor ${product.name}`}
                  loading="lazy"
                  className="h-24 w-24 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900" title={product.name}>
                    {product.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {product.sku ? `SKU: ${product.sku}` : "Geen SKU"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <a
                      href={`/api/products/${product.id}/qr.png`}
                      download
                      className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      PNG
                    </a>
                    <a
                      href={`/api/products/${product.id}/qr.svg`}
                      download
                      className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      SVG
                    </a>
                    <a
                      href={`/api/products/${product.id}/qr-label.pdf`}
                      download
                      className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      PDF-label
                    </a>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                Pagina {page} van {totalPages} ({total} producten)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Vorige
                </Button>
                <Button
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Volgende
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
