export const MAX_EMBEDDED_CHECKS = 30;
export function parsePortList(value: unknown): number[] {
  if(value===undefined || value==="") return [];
  if(typeof value!=="string" || value.length>1024) throw new Error("Port lists must be text of at most 1,024 characters.");
  if(!value.trim()) return [];
  const ports=new Set<number>();
  for(const item of value.split(",")){
    const match=/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(item.trim());
    if(!match) throw new Error("Use comma-separated ports or inclusive ranges, for example 22,80,443 or 8000-8003.");
    const first=Number(match[1]),last=Number(match[2]??match[1]);
    if(first<1||last>65535||first>last) throw new Error("Ports must be between 1 and 65535; ranges must be ascending.");
    if(last-first+1>MAX_EMBEDDED_CHECKS) throw new Error("Maximum 30 combined TCP/UDP checks per scan.");
    for(let p=first;p<=last;p++) ports.add(p);
    if(ports.size>MAX_EMBEDDED_CHECKS) throw new Error("Maximum 30 combined TCP/UDP checks per scan.");
  }
  return [...ports].sort((a,b)=>a-b);
}
export function customPorts(tcp: unknown,udp: unknown){
  const tcpPorts=parsePortList(tcp),udpPorts=parsePortList(udp);
  if(tcpPorts.length+udpPorts.length===0) throw new Error("Enter at least one TCP or UDP port.");
  if(tcpPorts.length+udpPorts.length>MAX_EMBEDDED_CHECKS) throw new Error("Maximum 30 combined TCP/UDP checks per scan; the same port in both protocols counts twice.");
  return {tcpPorts,udpPorts};
}
