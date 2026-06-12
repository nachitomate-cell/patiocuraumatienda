"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Mode = "normal" | "grande";

const Ctx = createContext<{ mode: Mode; toggle: () => void }>({
  mode: "normal",
  toggle: () => {},
});

export function UiModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("normal");

  useEffect(() => {
    const guardado = localStorage.getItem("uimode");
    if (guardado === "grande" || guardado === "normal") setMode(guardado);
  }, []);

  const toggle = () =>
    setMode((m) => {
      const nuevo: Mode = m === "grande" ? "normal" : "grande";
      localStorage.setItem("uimode", nuevo);
      return nuevo;
    });

  return <Ctx.Provider value={{ mode, toggle }}>{children}</Ctx.Provider>;
}

export const useUiMode = () => useContext(Ctx);
