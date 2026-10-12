import { HISTORY, SOURCES } from "./campaign-facts";

export function CaneHistory() {
  return (
    <section aria-labelledby="why-cane-heading" className="py-12">
      <h2 id="why-cane-heading" className="text-3xl font-bold text-lions-blue mb-6">
        Why a white cane
      </h2>
      <p className="text-gray-700 text-lg leading-relaxed mb-6">
        A white cane is a tool for independence and a signal to everyone nearby. The Lions have
        helped tell that story for more than ninety years.
      </p>
      <ol className="space-y-4">
        {HISTORY.map((item) => (
          <li key={item.year} className="bg-white rounded-2xl shadow-sm p-5 sm:flex sm:gap-6">
            <p className="font-bold text-lions-blue sm:w-24 sm:flex-shrink-0">{item.year}</p>
            <p className="text-gray-700 leading-relaxed mt-1 sm:mt-0">{item.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CaneSources() {
  return (
    <p className="text-sm text-gray-600">
      Sources:{" "}
      {SOURCES.map((s, i) => (
        <span key={s.href}>
          {i > 0 && "; "}
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lions-blue underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
          >
            {s.label}
          </a>
        </span>
      ))}
      .
    </p>
  );
}
