import React, { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { cn } from "../utils/cn";

interface ProfileAvatarProps {
  src?: string | null;
  name?: string | null;
  className?: string;
}

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  src,
  name,
  className,
}) => {
  const [failed, setFailed] = useState(false);
  const label = String(name || "Student").trim();
  const initials = label
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "S";

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
        className
      )}
      role="img"
      aria-label={`${label} profile picture`}
    >
      {src && !failed ? (
        <AuthenticatedImage
          src={src}
          alt=""
          className="size-full object-cover"
          fallbackClassName="size-full"
          onFail={() => setFailed(true)}
        />
      ) : (
        <span className="inline-flex size-full items-center justify-center">
          {label === "Student" ? <UserRound className="size-4" /> : initials}
        </span>
      )}
    </div>
  );
};
