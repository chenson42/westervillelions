"use client";

import Image from "next/image";
import { useState } from "react";

interface ServiceCardProps {
  image: string;
  alt: string;
  title: string;
  description: string;
  color: string;
}

export function ServiceCard({ image, alt, title, description, color }: ServiceCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden group">
      <div className={`h-56 bg-gradient-to-br ${color} relative`}>
        {!imageError && (
          <>
            <Image
              src={image}
              alt={alt}
              fill
              className="object-cover object-top"
              onError={() => setImageError(true)}
            />
            <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-40 group-hover:opacity-0 transition-opacity duration-300`} />
          </>
        )}
      </div>
      <div className="p-8">
        <h3 className="text-2xl font-bold mb-4 text-lions-red">
          {title}
        </h3>
        <p className="text-gray-700 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
