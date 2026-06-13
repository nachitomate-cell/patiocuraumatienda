"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface Props {
  value: string;
  height?: number;
  width?: number;
  fontSize?: number;
}

// Genera un código de barras Code 128 (admite letras, números y guiones).
export function CodigoBarra({ value, height = 45, width = 1.6, fontSize = 13 }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        height,
        width,
        fontSize,
        margin: 4,
        displayValue: true,
      });
    } catch {
      /* valor inválido: no renderiza */
    }
  }, [value, height, width, fontSize]);

  return <svg ref={ref} className="mx-auto max-w-full" />;
}
