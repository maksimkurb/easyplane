/** The EasyPlane mark, shared by the sidebar, the phone top bar and login. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={
        className ?? "block size-8 flex-none text-[#135f94] dark:text-[#7fb6e6]"
      }
    >
      <svg
        aria-hidden="true"
        className="size-full"
        fill="none"
        viewBox="0 0 512 512"
      >
        <path
          d="M308,120 H182 Q136,120 136,166 V346 Q136,392 182,392 H308 M136,256 H348"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="50"
        />
        <circle cx="336" cy="120" fill="currentColor" r="50" />
        <circle cx="376" cy="256" fill="currentColor" r="50" />
        <circle cx="336" cy="392" fill="currentColor" r="50" />
      </svg>
    </span>
  )
}
