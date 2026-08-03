import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPageTour, type TourStage } from "@/lib/onboardingTour";

/** Small header affordance that launches this page's focused tour on demand. */
export function PageTourButton({ stage }: { stage: TourStage }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Tour this page"
      title="Tour this page"
      onClick={() => startPageTour(stage)}
    >
      <CircleHelp />
    </Button>
  );
}
