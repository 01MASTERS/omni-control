import os from "node:os";
import { networkInterfaces } from "node:os";
import { DashboardSnapshot } from "../types";
import { DeviceRegistry } from "./device-registry";

type CpuSample = { idle: number; total: number };

function readCpuSample(): CpuSample {
  return os.cpus().reduce(
    (sample, cpu) => ({
      idle: sample.idle + cpu.times.idle,
      total: sample.total + Object.values(cpu.times).reduce((sum, value) => sum + value, 0),
    }),
    { idle: 0, total: 0 },
  );
}

function getLocalIp(): string {
  const nets = networkInterfaces();
  const candidates: { address: string; score: number }[] = [];

  for (const [name, netInterfaces] of Object.entries(nets)) {
    if (!netInterfaces) continue;
    const lowerName = name.toLowerCase();

    for (const net of netInterfaces) {
      if (net.family === "IPv4" && !net.internal) {
        let score = 0;

        // Penalize virtual, loopback, tunnel, or hotspot virtual adapters
        if (
          lowerName.includes("*") ||
          lowerName.includes("virtual") ||
          lowerName.includes("vethernet") ||
          lowerName.includes("pseudo") ||
          lowerName.includes("wsl") ||
          lowerName.includes("docker") ||
          lowerName.includes("host-only") ||
          lowerName.includes("vmware") ||
          lowerName.includes("vbox") ||
          lowerName.includes("tailscale") ||
          lowerName.includes("wireguard")
        ) {
          score -= 100;
        }

        // Penalize Windows ICS hotspot default subnet (192.168.137.x)
        if (net.address.startsWith("192.168.137.")) {
          score -= 50;
        }

        // Prioritize physical Wi-Fi and Ethernet adapters
        if (
          lowerName.includes("wi-fi") ||
          lowerName.includes("wifi") ||
          lowerName.includes("wlan") ||
          lowerName.includes("wireless")
        ) {
          score += 50;
        } else if (
          lowerName.includes("ethernet") ||
          lowerName.includes("eth") ||
          lowerName.startsWith("en")
        ) {
          score += 40;
        }

        candidates.push({ address: net.address, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address ?? "localhost";
}

export class DashboardService {
  private previousCpuSample = readCpuSample();

  constructor(private readonly deviceRegistry: DeviceRegistry) {}

  getSnapshot(): DashboardSnapshot {
    const currentCpuSample = readCpuSample();
    const totalDelta = currentCpuSample.total - this.previousCpuSample.total;
    const idleDelta = currentCpuSample.idle - this.previousCpuSample.idle;
    this.previousCpuSample = currentCpuSample;

    return {
      cpuUsagePercent:
        totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0,
      memoryUsedBytes: os.totalmem() - os.freemem(),
      memoryTotalBytes: os.totalmem(),
      uptimeSeconds: Math.floor(os.uptime()),
      devices: this.deviceRegistry.list(),
      serverIp: getLocalIp(),
    };
  }
}
