import { useLocation } from "react-router";
import { load, trackPageview } from "fathom-client";
import { useEffect } from "react";

const FATHOM_SITE_ID = import.meta.env.VITE_FATHOM_SITE_ID;
const FATHOM_DOMAINS = import.meta.env.VITE_FATHOM_DOMAINS;

export default function Fathom() {
  const location = useLocation();

  useEffect(() => {
    if (!FATHOM_SITE_ID) return;
    load(FATHOM_SITE_ID, {
      ...(FATHOM_DOMAINS ? { includedDomains: FATHOM_DOMAINS.split(",") } : {}),
    });
  }, []);

  useEffect(() => {
    if (!FATHOM_SITE_ID) return;
    trackPageview();
  }, [location.pathname, location.search]);

  return null;
}
