import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import {
  BLOCKED_IPV4_RANGES,
  BLOCKED_IPV6_RANGES,
  IPV4_MAPPED_IPV6_PATTERN,
  IP_FAMILY,
  IP_VERSION_6,
  LOCAL_DEVELOPMENT_HOSTS,
  PRODUCTION_ENVIRONMENT,
  URL_IPV6_BRACKETS_PATTERN,
  URL_PROTOCOL,
  URL_SAFETY_PROBLEM,
} from '@/constants';

/** All address ranges that outgoing webhook calls must never reach. */
const blockedAddresses = new BlockList();
for (const [network, prefixLength] of BLOCKED_IPV4_RANGES) blockedAddresses.addSubnet(network, prefixLength, IP_FAMILY.ipv4);
for (const [network, prefixLength] of BLOCKED_IPV6_RANGES) blockedAddresses.addSubnet(network, prefixLength, IP_FAMILY.ipv6);

/**
 * Checks whether an IP address is private, loopback, link-local, multicast or otherwise not public.
 *
 * @param ipAddress - An IPv4 or IPv6 address.
 * @returns True when the address must not be called (anything that isn't an IP also counts as unsafe).
 */
export function isPrivateIpAddress(ipAddress: string): boolean {
  const version = isIP(ipAddress);
  if (version === 0) return true; // Not an IP at all: treat as unsafe.
  if (version === IP_VERSION_6) {
    // "::ffff:10.0.0.1" is an IPv4 address in IPv6 clothing; check the IPv4 part too.
    const mappedIpv4 = IPV4_MAPPED_IPV6_PATTERN.exec(ipAddress)?.[1];
    if (mappedIpv4 && blockedAddresses.check(mappedIpv4, IP_FAMILY.ipv4)) return true;
    return blockedAddresses.check(ipAddress, IP_FAMILY.ipv6);
  }
  return blockedAddresses.check(ipAddress, IP_FAMILY.ipv4);
}

/**
 * Checks that a URL is safe for the server to call (protection against SSRF):
 * - https only (http allowed for localhost only when NODE_ENV is not "production", for local testing),
 * - no username/password in the URL,
 * - every address the host name resolves to is public.
 *
 * Call it when a webhook is saved AND right before each delivery, because DNS answers can change.
 *
 * @param rawUrl - The URL to check.
 * @returns A reason (from URL_SAFETY_PROBLEM) when unsafe, or null when safe.
 */
export async function findUrlSafetyProblem(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return URL_SAFETY_PROBLEM.invalidUrl;
  }
  if (url.username || url.password) return URL_SAFETY_PROBLEM.hasCredentials;

  const hostName = url.hostname.replace(URL_IPV6_BRACKETS_PATTERN, '');
  const isLocalDevelopmentUrl =
    process.env.NODE_ENV !== PRODUCTION_ENVIRONMENT && url.protocol === URL_PROTOCOL.http && LOCAL_DEVELOPMENT_HOSTS.includes(hostName);
  if (isLocalDevelopmentUrl) return null;
  if (url.protocol !== URL_PROTOCOL.https) return URL_SAFETY_PROBLEM.notHttps;

  try {
    const resolvedAddresses = isIP(hostName) ? [{ address: hostName }] : await lookup(hostName, { all: true, verbatim: true });
    if (resolvedAddresses.length === 0) return URL_SAFETY_PROBLEM.doesNotResolve;
    if (resolvedAddresses.some(({ address }) => isPrivateIpAddress(address))) return URL_SAFETY_PROBLEM.privateAddress;
  } catch {
    return URL_SAFETY_PROBLEM.doesNotResolve;
  }
  return null;
}
