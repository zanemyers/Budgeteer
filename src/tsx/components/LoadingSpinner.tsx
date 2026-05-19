import { Loader2 } from "lucide-react";

interface Props {
  message?: string;
}

export default function LoadingSpinner({ message = "Loading..." }: Props) {
  return (
    <div className="flex justify-center items-center py-12 gap-3">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
      <span className="text-muted-foreground">{message}</span>
      <span className="sr-only">{message}</span>
    </div>
  );
}
