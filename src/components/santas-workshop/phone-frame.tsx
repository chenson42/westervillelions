/** At md+ the screen renders inside a 390px device frame so desktop reviewers see phone proportions. */
export function PhoneFrame({
  children,
  className = "",
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className={`mx-auto w-full overflow-hidden md:max-w-[390px] md:rounded-2xl md:border-[10px] md:border-gray-900 md:shadow-2xl ${className}`}
    >
      {children}
    </section>
  );
}
