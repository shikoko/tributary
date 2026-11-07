import { useEffect } from "react";
import { CheckIcon } from "./Icons";

/** A short confirmation at the bottom of the window that goes away by itself. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3500);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  return (
    <div className="toast" role="status">
      <CheckIcon size={14} />
      {message}
    </div>
  );
}
