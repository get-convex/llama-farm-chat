import { se } from "@/lib/utils";
import { AnchorHTMLAttributes } from "react";

export const Link = se<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement>
>("a", "font-medium text-primary");
