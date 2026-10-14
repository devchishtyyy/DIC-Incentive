/**
 * Importing the employee roster from SAP SuccessFactors.
 *
 * The source is the OData v2 `User` entity:
 *
 *   GET /odata/v2/User?$filter=userId ge '40000000' and userId le '40009999' and status eq 't'
 *
 * Four of our fields come straight out of it — userId, the name parts, hireDate and
 * location. The other four do not exist in the standard entity and differ per tenant:
 * grade band, Operator vs Supervisor, and probation. So nothing here hard-codes a field
 * name: the mapping is configuration, `suggestMapping` guesses it from the field names
 * actually present in the payload, and the import screen shows the guess for confirmation
 * before anything is written.
 */

import type { Employee, EmployeeStatus, IsoDate, Site } from '../domain/types'
import { assignedPointIds, floorEmpIdFrom } from './plantMasters'

/** One record as SAP returns it. Deliberately loose — tenants add their own fields. */
export type SapUser = Record<string, unknown>

// ---------------------------------------------------------------------------
// Reading the payload
// ---------------------------------------------------------------------------

export interface ParsedPayload {
  users: SapUser[]
  /** Every field name seen across the records, so the mapping UI can offer them. */
  fields: string[]
  error: string | null
}

/**
 * Accepts what the API actually returns (`{ d: { results: [...] } }`), what a newer OData
 * version returns (`{ value: [...] }`), or a bare array someone pasted out of a tool.
 */
export function parseSapPayload(text: string): ParsedPayload {
  const empty: ParsedPayload = { users: [], fields: [], error: null }
  if (!text.trim()) return { ...empty, error: 'Nothing to read — paste the JSON response or drop the file in.' }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ...empty, error: 'That is not valid JSON. Save the raw API response without editing it.' }
  }

  const rows = extractRows(json)
  if (rows === null) {
    return { ...empty, error: 'No user records found. Expected { d: { results: [...] } }, { value: [...] } or a plain array.' }
  }
  if (rows.length === 0) {
    return { ...empty, error: 'The response parsed, but it contains no users. Check the $filter on the request.' }
  }

  const fields = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      // OData adds a __metadata block to every record; it is not data.
      if (key !== '__metadata') fields.add(key)
    }
  }

  return { users: rows, fields: [...fields].sort(), error: null }
}

function extractRows(json: unknown): SapUser[] | null {
  if (Array.isArray(json)) return json as SapUser[]
  if (!json || typeof json !== 'object') return null

  const record = json as Record<string, unknown>
  const d = record.d as Record<string, unknown> | undefined
  if (d && Array.isArray(d.results)) return d.results as SapUser[]
  if (d && typeof d === 'object' && !Array.isArray(d)) return [d as SapUser]
  if (Array.isArray(record.value)) return record.value as SapUser[]
  if (Array.isArray(record.results)) return record.results as SapUser[]
  return null
}

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

/**
 * Which SAP field feeds each of ours.
 *
 * Job title is deliberately absent: it does not reliably say who is a Supervisor, so
 * everyone is imported as an Operator and the Admin promotes anyone who is not.
 */
export interface FieldMapping {
  empId: string
  firstName: string
  lastName: string
  /** Used only when there is no separate first/last name. */
  fullName: string
  hireDate: string
  /** The SAP pay grade. Shown on screen in place of the job title. */
  gradeField: string
  /** Source for the site, then a value → Kasur / Karachi / Inplant lookup. */
  siteField: string
  siteValues: Record<string, Site>
}

export const EMPTY_MAPPING: FieldMapping = {
  empId: '',
  firstName: '',
  lastName: '',
  fullName: '',
  hireDate: '',
  gradeField: '',
  siteField: '',
  siteValues: {},
}

/** Field names we expect, best first. Matching is case-insensitive and ignores separators. */
const CANDIDATES: Record<keyof Omit<FieldMapping, 'siteValues'>, string[]> = {
  empId: ['userid', 'empid', 'personidexternal', 'employeeid', 'username'],
  firstName: ['firstname', 'givenname'],
  lastName: ['lastname', 'familyname', 'surname'],
  fullName: ['displayname', 'defaultfullname', 'fullname', 'name'],
  hireDate: ['hiredate', 'dateofhire', 'startdate', 'originalstartdate'],
  gradeField: ['paygrade', 'grade', 'joblevel', 'salarygrade'],
  siteField: ['location', 'city', 'site'],
}

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Picks the most likely source field for each of ours, from what the payload actually has. */
export function suggestMapping(fields: string[]): FieldMapping {
  const byNormalised = new Map(fields.map((field) => [normalise(field), field]))
  const pick = (options: string[]): string => {
    for (const option of options) {
      const hit = byNormalised.get(normalise(option))
      if (hit) return hit
    }
    return ''
  }

  return {
    ...EMPTY_MAPPING,
    empId: pick(CANDIDATES.empId),
    firstName: pick(CANDIDATES.firstName),
    lastName: pick(CANDIDATES.lastName),
    fullName: pick(CANDIDATES.fullName),
    hireDate: pick(CANDIDATES.hireDate),
    gradeField: pick(CANDIDATES.gradeField),
    siteField: pick(CANDIDATES.siteField),
  }
}

/** The distinct values a mapped field takes, so the area and site lookups can be built. */
export function distinctValues(users: SapUser[], field: string): string[] {
  if (!field) return []
  const seen = new Set<string>()
  for (const user of users) {
    const value = readString(user, field)
    if (value) seen.add(value)
  }
  return [...seen].sort()
}

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------

function readString(user: SapUser, field: string): string {
  if (!field) return ''
  const value = user[field]
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value).trim()
}

/**
 * SAP dates come as `/Date(1234567890000)/`, an ISO string, or `YYYY-MM-DD`.
 * Anything unreadable returns null rather than a wrong date.
 */
export function readSapDate(raw: string): IsoDate | null {
  if (!raw) return null

  const edm = /^\/Date\((-?\d+)([+-]\d+)?\)\/$/.exec(raw)
  if (edm) {
    const date = new Date(Number(edm[1]))
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Mapping onto our Employee
// ---------------------------------------------------------------------------

export interface MappedEmployee {
  employee: Employee
  /** Fields that could not be resolved — shown in the preview, never silently dropped. */
  warnings: string[]
}

export interface ImportResult {
  mapped: MappedEmployee[]
  /** Records that cannot become an employee at all, with the reason. */
  rejected: Array<{ user: SapUser; reason: string }>
  /** Counts of each unresolved lookup value, so the mapping can be finished. */
  unmappedSites: Record<string, number>
  /** How many were matched to a Point assignment, and how that match was made. */
  pointsMatched: number
  /** True when the SAP Emp IDs only matched on their trailing digits — worth saying. */
  matchedOnSuffix: boolean
}

/**
 * Turns a SuccessFactors userId into the Emp ID the floor uses, and finds that person's
 * Point assignment. SAP 40001295 is Emp ID 1295, and 1295 is what the Employee KPI sheet
 * expects, so the floor value is what gets stored.
 */
export function matchEmpId(sapUserId: number): { empId: number; points: string[]; viaSuffix: boolean } {
  const floorId = floorEmpIdFrom(sapUserId)
  return {
    empId: floorId,
    points: assignedPointIds(floorId),
    viaSuffix: floorId !== sapUserId,
  }
}

export function mapSapUsers(users: SapUser[], mapping: FieldMapping): ImportResult {
  const mapped: MappedEmployee[] = []
  const rejected: ImportResult['rejected'] = []
  const unmappedSites: Record<string, number> = {}
  const seenIds = new Set<number>()
  let pointsMatched = 0
  let matchedOnSuffix = false

  for (const user of users) {
    const warnings: string[] = []

    const rawId = readString(user, mapping.empId)
    const sapUserId = Number(rawId)
    if (!rawId) {
      rejected.push({ user, reason: `No value in "${mapping.empId || 'Emp ID'}"` })
      continue
    }
    if (!Number.isFinite(sapUserId)) {
      rejected.push({ user, reason: `Emp ID "${rawId}" is not a number` })
      continue
    }
    const match = matchEmpId(sapUserId)
    const empId = match.empId
    if (seenIds.has(empId)) {
      rejected.push({ user, reason: `Emp ID ${empId} appears more than once in the payload` })
      continue
    }
    seenIds.add(empId)

    // --- Name ---------------------------------------------------------------
    const first = readString(user, mapping.firstName)
    const last = readString(user, mapping.lastName)
    const full = readString(user, mapping.fullName)
    const name = [first, last].filter(Boolean).join(' ') || full
    if (!name) {
      rejected.push({ user, reason: `No name for Emp ID ${empId}` })
      continue
    }

    // --- Points --------------------------------------------------------------
    if (match.points.length > 0) {
      pointsMatched += 1
      if (match.viaSuffix) matchedOnSuffix = true
    } else {
      warnings.push('No Point assignment on file — assign their Points before they can be posted for')
    }

    // --- Site ---------------------------------------------------------------
    const rawSite = readString(user, mapping.siteField)
    let site = mapping.siteValues[rawSite]
    if (!site) {
      if (rawSite) unmappedSites[rawSite] = (unmappedSites[rawSite] ?? 0) + 1
      site = 'Kasur'
      if (rawSite) warnings.push(`Site "${rawSite}" is not mapped — defaulted to Kasur`)
    }

    // --- Pay grade ----------------------------------------------------------
    const grade = readString(user, mapping.gradeField)
    if (!grade) warnings.push('No pay grade in the source')

    // --- Service dates ------------------------------------------------------
    const joinDate = readSapDate(readString(user, mapping.hireDate))
    if (!joinDate) warnings.push('No joining date — pro-rata cannot be applied until it is set')

    mapped.push({
      employee: {
        empId,
        sapUserId,
        name,
        grade: grade || '—',
        site,
        // Job title does not reliably say who supervises, so everyone arrives as an
        // Operator and the Admin promotes the handful who are not.
        role: 'Operator',
        // SuccessFactors has no probation flag on User.
        status: 'Active' as EmployeeStatus,
        pointIds: match.points,
        joinDate: joinDate ?? '',
        leaveDate: null,
        // Policy section 10: joining the incentive list needs MD approval, import included.
        incentiveListStatus: 'Pending MD approval',
        requestedAt: new Date().toISOString(),
        active: true,
      },
      warnings,
    })
  }

  return { mapped, rejected, unmappedSites, pointsMatched, matchedOnSuffix }
}

/** True once every field the app needs has a source. */
export function mappingIsComplete(mapping: FieldMapping): boolean {
  const hasName = Boolean(mapping.firstName || mapping.fullName)
  return Boolean(mapping.empId) && hasName
}
