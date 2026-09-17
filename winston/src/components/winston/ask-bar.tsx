import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AskBar({
  onAsk,
  disabled,
}: {
  onAsk: (text: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onAsk(text);
    setValue("");
  };

  return (
    <form
      className="flex items-center gap-2 rounded-xl bg-surface p-1.5 shadow-[var(--shadow-border)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor="winston-ask">
        Ask Winston
      </label>
      <input
        id="winston-ask"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask for a recipe or process"
        disabled={disabled}
        className="h-11 min-w-0 flex-1 bg-transparent px-3 text-base text-fg outline-none placeholder:text-subtle"
      />
      <Button
        type="submit"
        size="icon"
        disabled={disabled || !value.trim()}
        aria-label="Ask"
      >
        <ArrowUp />
      </Button>
    </form>
  );
}
