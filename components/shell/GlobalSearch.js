"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { BoxIcon, BuildingIcon, FileIcon, SearchIcon, UsersIcon } from "@/components/ui/icons";

const GROUP_ICONS = { products: BoxIcon, documents: FileIcon, users: UsersIcon, companies: BuildingIcon };

// Globale zoekbalk in de kop. Debounce van 250 ms en minimaal 2 tekens: nooit een
// request per toetsaanslag. Ctrl/Cmd+K of "/" zet de focus erin. Resultaten zijn
// per type gegroepeerd en met pijltjes + Enter te kiezen.
export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    function onKey(event) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setGroups([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get(`/api/search?q=${encodeURIComponent(term)}`)
        .then((data) => {
          if (!cancelled) {
            setGroups(data.groups || []);
            setActive(0);
          }
        })
        .catch(() => !cancelled && setGroups([]))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const flat = groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.type })));

  function go(item) {
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      go(flat[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showPanel = open && query.trim().length >= 2;
  let index = -1;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <SearchIcon size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Zoeken in producten, documenten en meer"
        placeholder="Zoeken… (Ctrl+K)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      {showPanel && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg sm:min-w-[24rem]">
          {loading && !flat.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">Zoeken…</p>
          ) : !flat.length ? (
            <p className="px-4 py-3 text-sm text-slate-500">Niets gevonden voor &quot;{query.trim()}&quot;.</p>
          ) : (
            groups.map((group) => {
              const Icon = GROUP_ICONS[group.type] || BoxIcon;
              return (
                <div key={group.type} role="group" aria-label={group.label}>
                  <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
                  {group.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <button
                        key={`${group.type}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(item)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === active ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                      >
                        <Icon size={16} className="text-slate-400" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-slate-900">{item.title}</span>
                          {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
