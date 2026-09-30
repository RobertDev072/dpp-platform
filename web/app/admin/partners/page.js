"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { USER_STATUS_BADGE_VARIANTS, statusLabel } from "@/lib/labels";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import AdminStatTile from "@/components/admin/AdminStatTile";
import { initialsOf } from "@/components/admin/listUtils";
import UsageBar from "@/components/license/UsageBar";
import LicenseStatusBadge from "@/components/license/LicenseStatusBadge";
import { formatValidity } from "@/components/license/licenseFormat";

// Partneroverzicht van de Platform Owner: alle partnerbedrijven met hun
// klanttenants en het licentieverbruik daarvan. Beide lijsten komen client-side
// uit bestaande endpoints (bedrijvenlijst + licentie-overzicht).
export default function PartnersPage() {
  const [companies, setCompanies] = useState([]);
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Partner waarvan de klantenlijst uitgeklapt is (één tegelijk).
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/api/admin/companies"), api.get("/api/admin/licenses/overview")])
      .then(([companyData, overviewData]) => {
        setCompanies(companyData);
        setOverview(overviewData);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const partners = useMemo(
    () =>
      companies
        .filter((company) => company.kind === "partner")
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "nl")),
    [companies]
  );

  function customersOf(partner) {
    return companies.filter((company) => company.partner_id === partner.id);
  }

  function customerLicensesOf(partner) {
    return overview.filter((row) => row.partnerId === partner.id);
  }

  const totalCustomers = useMemo(
    () => companies.filter((company) => company.partner_id != null).length,
    [companies]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Partners</h1>
          <p className="mt-1 text-sm text-slate-500">
            Partners/resellers en de klantbedrijven die zij beheren.
          </p>
        </div>
        <Link
          href="/admin/companies/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Nieuw bedrijf
        </Link>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 text-red-700">{loadError}</Card>}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index}>
              <Skeleton className="h-12 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <AdminStatTile label="Partners" value={partners.length} />
          <AdminStatTile label="Klanten via partners" value={totalCustomers} />
        </div>
      )}

      <Card>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : partners.length === 0 ? (
          <EmptyState
            title="Nog geen partners"
            description="Maak een partnerbedrijf aan via Nieuw bedrijf en kies daar het type Partnerbedrijf."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Partner</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Klanten</th>
                  <th className="py-2 pr-3 font-medium">Acties</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => (
                  <PartnerRows
                    key={partner.id}
                    partner={partner}
                    customerCount={customersOf(partner).length}
                    customerLicenses={customerLicensesOf(partner)}
                    expanded={expandedId === partner.id}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === partner.id ? null : partner.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// Tabelrij(en) voor één partner: hoofdregel + optionele uitklap met de klanten
// en hun licentieverbruik (zelfde stijl als de plan-uitklap op Abonnementen).
function PartnerRows({ partner, customerCount, customerLicenses, expanded, onToggle }) {
  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-sm font-semibold text-purple-700"
            >
              {initialsOf(partner.name)}
            </div>
            <div>
              <p className="font-medium text-slate-900">{partner.name}</p>
              <p className="text-xs text-slate-500">{partner.slug}</p>
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3">
          <Badge variant={USER_STATUS_BADGE_VARIANTS[partner.status] || "neutral"}>
            {statusLabel(partner.status)}
          </Badge>
        </td>
        <td className="py-2.5 pr-3 text-slate-600">{customerCount}</td>
        <td className="py-2.5 pr-3">
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {expanded ? "Klanten verbergen" : "Klanten bekijken"}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={4} className="p-4">
            {customerLicenses.length === 0 ? (
              <EmptyState
                title="Nog geen klantbedrijven"
                description="Deze partner heeft nog geen klanttenants aangemaakt."
              />
            ) : (
              <ul className="space-y-2">
                {customerLicenses.map((customer) => (
                  <li key={customer.companyId} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{customer.name}</span>
                        {customer.plan ? (
                          <Badge variant="info">{customer.plan.name}</Badge>
                        ) : (
                          <Badge variant="neutral">Geen plan</Badge>
                        )}
                        <span className="text-xs text-slate-500">
                          {formatValidity(customer.licenseStart, customer.licenseEnd)}
                        </span>
                      </div>
                      <LicenseStatusBadge status={customer.status} />
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <UsageBar label="Gebruikers" {...customer.users} />
                      <UsageBar label="Producten" {...customer.products} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
