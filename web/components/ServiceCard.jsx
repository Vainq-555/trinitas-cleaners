import {
  Sparkles,
  Wrench,
  Layers,
  Droplets,
  Wind,
  Paintbrush,
} from "lucide-react";

const iconMap = {
  "Window": Droplets,
  "Screen": Layers,
  "Package": Sparkles,
  "Carpet": Paintbrush,
  "Pressure": Wind,
  "Washing": Wind,
};

// Renders a single service as a modern card with hover lift.
export default function ServiceCard({ service, action, price }) {
  const Icon = iconMap[service.name.split(" ")[0]] || Sparkles;
  const displayPrice = price !== undefined ? price : service.price ?? service.basePrice;

  return (
    <div className="card group p-6 flex flex-col transition-all duration-200 hover:-translate-y-1 hover:shadow-lift">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-light text-brand group-hover:bg-brand group-hover:text-white transition-colors">
        <Icon size={22} />
      </span>
      <h3 className="mt-4 text-lg font-bold text-ink group-hover:text-brand transition-colors">{service.name}</h3>
      <p className="mt-2 text-sm text-muted leading-relaxed flex-1">{service.description}</p>
      <div className="mt-5 pt-4 border-t border-line flex items-center justify-between">
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-muted font-semibold">Starting at</span>
          <span className="text-xl font-extrabold text-brand">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(displayPrice)}
          </span>
        </div>
        {action}
      </div>
    </div>
  );
}