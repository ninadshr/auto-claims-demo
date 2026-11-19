import Workbench from "@/components/Workbench";

/**
 * Single-page interactive workbench (plan §4). This is a static shell — all
 * live data (model-tier availability, golden set) is fetched client-side from
 * /api/eval so key status always reflects the running environment.
 */
export default function Home() {
  return <Workbench />;
}
