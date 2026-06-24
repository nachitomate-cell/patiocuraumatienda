"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Store, TrendingUp } from "lucide-react";

const TABS = [
  { href: "/crm", label: "General", Icon: BarChart3 },
  { href: "/crm/por-emprendedor", label: "Por emprendedor", Icon: Store },
  { href: "/crm/variacion", label: "Variación mensual", Icon: TrendingUp },
];

export function CrmTabs() {
  const path = usePathname();
  return (
    <div className="bg-white rounded-xl shadow p-1.5 flex gap-1 overflow-x-auto no-scrollbar anim-in">
      {TABS.map(({ href, label, Icon }) => {
        const active = path === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
              active
                ? "bg-cyan-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon size={16} /> {label}
          </Link>
        );
      })}
    </div>
  );
}
