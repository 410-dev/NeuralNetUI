"use client";

// Shared settings heading so every panel presents the same icon, title and description rhythm.
export function SectionTitle({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: React.ReactNode; action?: React.ReactNode }) { return <div className="section-title"><span className="title-icon">{icon}</span><div><h3>{title}</h3><p>{description}</p></div>{action}</div>; }
