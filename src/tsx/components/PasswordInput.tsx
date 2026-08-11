import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

/** Password field with a show/hide reveal toggle. Forwards all Input props except `type`. */
export function PasswordInput({ className = "", ...props }: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className={`pr-10 ${className}`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        // Not .touch-target: that sets position:relative, which would undo the absolute placement.
        // The icon is 15px, so a centered 44px pseudo-element carries the tap target instead.
        className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-quiet hover:text-foreground touch:before:absolute touch:before:top-1/2 touch:before:left-1/2 touch:before:size-11 touch:before:-translate-x-1/2 touch:before:-translate-y-1/2 touch:before:content-['']"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
