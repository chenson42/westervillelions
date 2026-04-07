"use client";

import { useState, useEffect, useCallback } from "react";
import type { Testimonial } from "@/lib/db/schema";

const AUTO_ADVANCE_MS = 6000;

export default function TestimonialCarousel({
  testimonials,
}: {
  testimonials: Testimonial[];
}) {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const goTo = useCallback(
    (index: number) => {
      setCurrent((index + testimonials.length) % testimonials.length);
    },
    [testimonials.length]
  );

  const goNext = useCallback(() => {
    goTo(current + 1);
  }, [current, goTo]);

  const goPrev = useCallback(() => {
    goTo(current - 1);
  }, [current, goTo]);

  useEffect(() => {
    if (isPaused || testimonials.length <= 1) return;
    const timer = setInterval(goNext, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [isPaused, goNext, testimonials.length]);

  if (testimonials.length === 0) return null;

  const testimonial = testimonials[current];

  return (
    <div
      className="my-10"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        Hear From Our Members
      </h2>

      <div className="relative">
        <div className="bg-white rounded-2xl shadow-lg px-8 py-8 sm:px-10">
          {/* Quote mark */}
          <svg
            className="h-8 w-8 text-lions-gold mb-4"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
          </svg>

          {/* Quote text */}
          <blockquote className="text-gray-700 italic text-lg leading-relaxed mb-6">
            {testimonial.quote}
          </blockquote>

          {/* Author */}
          <div>
            <p className="text-lions-blue font-semibold">{testimonial.authorName}</p>
            {testimonial.authorTitle && (
              <p className="text-gray-500 text-sm">{testimonial.authorTitle}</p>
            )}
          </div>
        </div>

        {/* Prev / Next arrows — only shown when there are multiple */}
        {testimonials.length > 1 && (
          <>
            <button
              onClick={goPrev}
              aria-label="Previous testimonial"
              className="absolute left-0 top-1/2 -translate-x-4 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md hover:shadow-lg border border-gray-200 text-gray-600 hover:text-lions-blue transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              onClick={goNext}
              aria-label="Next testimonial"
              className="absolute right-0 top-1/2 translate-x-4 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md hover:shadow-lg border border-gray-200 text-gray-600 hover:text-lions-blue transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Dot indicators */}
      {testimonials.length > 1 && (
        <div className="mt-5 flex justify-center gap-2" role="tablist" aria-label="Testimonial navigation">
          {testimonials.map((_, index) => (
            <button
              key={index}
              role="tab"
              aria-selected={index === current}
              aria-label={`Go to testimonial ${index + 1}`}
              onClick={() => goTo(index)}
              className={`h-2 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                index === current
                  ? "w-6 bg-lions-blue"
                  : "w-2 bg-gray-300 hover:bg-gray-400"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
