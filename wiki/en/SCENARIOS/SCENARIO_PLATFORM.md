# Scenario Platform

`simulation.worldUnitsPerKm` sets the horizontal distance scale (finite values from `0.001` to `1000000`; built-in scenarios use `10`). Console distances, tactical radar rings, guidance maps and Tacview horizontal coordinates follow it. Metre-valued uncertainty keeps its metre-to-kilometre conversion; Tacview altitude keeps its separate height convention. Missing or unsupported runtime values fall back to `10`, while scenario validation rejects unsupported values.

Scenarios use a data-only JSON document, TypeScript validation/normalization, compilation and runtime layers. The lifecycle is `load → normalize → validate → compile → runtime`.

Invalid IDs, duplicate entities, illegal routes and broken references are rejected before startup. Legacy scenarios enter through adapters, while `main.ts` only assembles dependencies and owns the frame/UI lifecycle.
