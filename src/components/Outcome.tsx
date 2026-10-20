import { useEffect, useRef, type ReactNode } from "react";
import { CircleCheck, Info } from "lucide-react";
/**
 * The headline of a finished job: what happened in a few words, then one
 * line of detail. Focus moves here so keyboard and screen reader users
 * land on the result.
 */
export function Outcome({
  title,
  detail,
  tone = "success",
}: {
  title: string;
  detail?: ReactNode;
  tone?: "success" | "neutral";
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const Icon = tone === "success" ? CircleCheck : Info;
  return (
    <div className={`outcome tone-${tone}`}>
      <Icon size={28} aria-hidden="true" />
      <div>
        <h3 ref={heading} tabIndex={-1}>
          {title}
        </h3>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  );
}
