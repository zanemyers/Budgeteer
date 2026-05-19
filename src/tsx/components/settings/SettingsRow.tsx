interface Props {
  label: string;
  description?: string;
  children: React.ReactNode;
}

export function SettingsRow({ label, description, children }: Props) {
  return (
    <div className="grid md:grid-cols-[14rem_1fr] gap-4 md:gap-8 py-6 first:pt-0 last:pb-0 border-t first:border-t-0">
      <div className="md:max-w-[12rem]">
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
        {description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
