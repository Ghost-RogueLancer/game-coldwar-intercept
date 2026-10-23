import * as THREE from "three";
import type { EmitterDefinition, EmitterInstance } from "./types.js";
// Initial silence is the baseline; the first observed transmission is an event.
export function emitterActivityChanged(previous: boolean | undefined, active: boolean) {
  return previous !== active && (previous !== undefined || active);
}

export class ArmEmitterRuntime {
  readonly emitters = new Map<string, EmitterInstance>();
  register(input:{id:string; platformId:string; definition:EmitterDefinition; position:THREE.Vector3; time?:number; decoy?:boolean}) {
    const time=input.time??0;
    const emitter:EmitterInstance={id:input.id,platformId:input.platformId,definitionId:input.definition.id,position:input.position.clone(),active:false,mode:"search",emissionStrength:0,lastActivatedAt:time,lastDeactivatedAt:time,health:1,decoy:input.decoy??false,band:input.definition.band};
    this.emitters.set(emitter.id,emitter); return emitter;
  }
  setActive(id:string, active:boolean, time:number, mode:EmitterInstance["mode"]="search") {
    const emitter=this.emitters.get(id); if(!emitter) return false;
    // A destroyed transmitter cannot radiate, whatever the caller asked for. `update()` already
    // enforces health<=0 => inactive, but it clears the flag directly, so a per-frame
    // `setActive(..., true, ...)` re-opened the emitter first: the caller saw a stale
    // emissionStrength for the rest of the frame, `lastActivatedAt` kept advancing while the
    // platform was dead, and `lastDeactivatedAt` was never stamped because the real down-edge
    // happened outside this method.
    const radiating = active && emitter.health > 0;
    if(emitter.active===radiating) { emitter.mode=mode; emitter.emissionStrength=radiating?Math.max(.05,emitter.health):0; return true; }
    emitter.active=radiating; emitter.mode=mode; emitter.emissionStrength=radiating?Math.max(.05,emitter.health):0;
    if(radiating) emitter.lastActivatedAt=time; else emitter.lastDeactivatedAt=time;
    return true;
  }
  update(now:number, positions:ReadonlyMap<string,THREE.Vector3>) {
    for(const emitter of this.emitters.values()) { const p=positions.get(emitter.platformId); if(p) emitter.position.copy(p); this.setActive(emitter.id,emitter.active,now,emitter.mode); }
  }
  remove(id:string){ return this.emitters.delete(id); }
  clear(){ this.emitters.clear(); }
}
