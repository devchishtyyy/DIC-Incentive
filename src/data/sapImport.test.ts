/**
 * The SAP import meets data we do not control, so it is tested against the shapes
 * SuccessFactors actually returns — including the awkward ones.
 *
 * Two things it deliberately does NOT take from SAP: the Point assignment (joined from
 * the plant list by Emp ID) and Operator-vs-Supervisor (the job title does not reliably
 * say, so everyone arrives as an Operator).
 */

import { describe, expect, it } from 'vitest'
import {
  distinctValues,
  EMPTY_MAPPING,
  mapSapUsers,
  mappingIsComplete,
  matchEmpId,
  parseSapPayload,
  readSapDate,
  suggestMapping,
  type FieldMapping,
} from './sapImport'
import { pointIdFor } from './plantMasters'

/** A realistic OData v2 User response — the metadata block and all. */
const PAYLOAD = JSON.stringify({
  d: {
    results: [
      {
        __metadata: { uri: "https://api44.sapsf.com/odata/v2/User('40001295')", type: 'SFOData.User' },
        userId: '40001295',
        username: 'ahmad.raza',
        firstName: 'Ahmad',
        lastName: 'Raza',
        payGrade: 'Grade C',
        location: 'Kasur Plant',
        jobTitle: 'Shift Supervisor',
        hireDate: '/Date(1593561600000)/',
        status: 't',
      },
      {
        __metadata: { uri: 'x', type: 'SFOData.User' },
        userId: '40006289',
        firstName: 'Bilal',
        lastName: 'Khan',
        payGrade: 'P2',
        location: 'Karachi',
        hireDate: '2021-03-15T00:00:00',
        status: 't',
      },
      {
        __metadata: { uri: 'y', type: 'SFOData.User' },
        userId: '40009999',
        firstName: 'Danish',
        lastName: 'Iqbal',
        location: 'Kasur Plant',
        hireDate: null,
        status: 't',
      },
    ],
  },
})

const parsed = parseSapPayload(PAYLOAD)
const mapping: FieldMapping = { ...suggestMapping(parsed.fields), siteValues: { 'Kasur Plant': 'Kasur', Karachi: 'Karachi' } }
const result = mapSapUsers(parsed.users, mapping)

// ---------------------------------------------------------------------------

describe('reading the response', () => {
  it('reads the OData v2 shape the API actually returns', () => {
    expect(parsed.error).toBeNull()
    expect(parsed.users).toHaveLength(3)
  })

  it('leaves the __metadata block out of the field list', () => {
    expect(parsed.fields).not.toContain('__metadata')
    expect(parsed.fields).toContain('userId')
  })

  it('collects fields that only some records have', () => {
    expect(parsed.fields).toContain('payGrade')
    expect(parsed.fields).toContain('jobTitle')
  })

  it('also accepts a newer { value: [...] } response', () => {
    expect(parseSapPayload('{"value":[{"userId":"1"}]}').users).toHaveLength(1)
  })

  it('also accepts a bare array pasted out of a tool', () => {
    expect(parseSapPayload('[{"userId":"1"}]').users).toHaveLength(1)
  })

  it('explains itself rather than throwing on rubbish', () => {
    expect(parseSapPayload('not json').error).toMatch(/not valid JSON/)
    expect(parseSapPayload('').error).toMatch(/Nothing to read/)
    expect(parseSapPayload('{"d":{"results":[]}}').error).toMatch(/no users/)
    expect(parseSapPayload('{"unexpected":true}').error).toMatch(/No user records/)
  })
})

describe('guessing the mapping', () => {
  const guess = suggestMapping(parsed.fields)

  it('finds the standard User fields', () => {
    expect(guess.empId).toBe('userId')
    expect(guess.firstName).toBe('firstName')
    expect(guess.lastName).toBe('lastName')
    expect(guess.hireDate).toBe('hireDate')
    expect(guess.siteField).toBe('location')
  })

  it('finds the pay grade', () => {
    expect(guess.gradeField).toBe('payGrade')
  })

  it('leaves a field unmapped rather than guessing wildly', () => {
    expect(suggestMapping(['userId']).siteField).toBe('')
  })

  it('lists distinct values so the site lookup can be built', () => {
    expect(distinctValues(parsed.users, 'location')).toEqual(['Karachi', 'Kasur Plant'])
    expect(distinctValues(parsed.users, '')).toEqual([])
  })
})

describe('SAP date formats', () => {
  it('reads the Edm.DateTime form', () => {
    expect(readSapDate('/Date(1593561600000)/')).toBe('2020-07-01')
  })

  it('reads an ISO date-time and a plain date', () => {
    expect(readSapDate('2021-03-15T00:00:00')).toBe('2021-03-15')
    expect(readSapDate('2021-03-15')).toBe('2021-03-15')
  })

  it('returns null rather than a wrong date', () => {
    expect(readSapDate('')).toBeNull()
    expect(readSapDate('not a date')).toBeNull()
  })
})

describe('joining a SAP user to their Point assignment', () => {
  // The floor uses a 4-digit Emp ID; SuccessFactors userId is 8 digits.
  it('matches an exact floor Emp ID', () => {
    const match = matchEmpId(1295)
    expect(match.points).toEqual([pointIdFor('Grinding + Loading'), pointIdFor('Grinding')])
    expect(match.viaSuffix).toBe(false)
  })

  it('matches an 8-digit SAP id on its trailing digits', () => {
    const match = matchEmpId(40001295)
    expect(match.empId).toBe(1295)
    expect(match.points).toEqual([pointIdFor('Grinding + Loading'), pointIdFor('Grinding')])
    expect(match.viaSuffix).toBe(true)
  })

  it('returns nothing for somebody not on the assignment list', () => {
    expect(matchEmpId(40009999).points).toEqual([])
  })

  it('reports that the suffix route was used, so it can be checked', () => {
    expect(result.matchedOnSuffix).toBe(true)
    expect(result.pointsMatched).toBe(2)
  })
})

describe('mapping onto our Employee', () => {
  it('maps every usable record', () => {
    expect(result.mapped).toHaveLength(3)
    expect(result.rejected).toHaveLength(0)
  })

  it('joins the name parts and keeps the Emp ID as the key', () => {
    expect(result.mapped[0].employee.empId).toBe(1295)
    expect(result.mapped[0].employee.name).toBe('Ahmad Raza')
  })

  it('takes the pay grade, not the job title', () => {
    expect(result.mapped[0].employee.grade).toBe('Grade C')
    expect(result.mapped[1].employee.grade).toBe('P2')
  })

  it('imports everyone as an Operator, however senior the job title sounds', () => {
    // The first record's jobTitle is "Shift Supervisor" and is deliberately ignored.
    expect(result.mapped.every((row) => row.employee.role === 'Operator')).toBe(true)
  })

  it('stores the floor Emp ID, not the 8-digit SAP one', () => {
    expect(result.mapped[0].employee.empId).toBe(1295)
    expect(result.mapped[0].employee.sapUserId).toBe(40001295)
  })

  it('leaves someone with no Points unassigned, and says so', () => {
    const unassigned = result.mapped[2]
    expect(unassigned.employee.pointIds).toEqual([])
    expect(unassigned.warnings.join(' ')).toContain('No Point assignment')
  })

  it('carries the Points through so Daily Entry can offer them', () => {
    expect(result.mapped[1].employee.pointIds).toContain(pointIdFor('UV Sampling'))
    expect(result.mapped[1].employee.pointIds).toContain(pointIdFor('UV Filling'))
  })

  it('resolves the site through the lookup', () => {
    expect(result.mapped[0].employee.site).toBe('Kasur')
    expect(result.mapped[1].employee.site).toBe('Karachi')
  })

  it('reads the joining date in whichever format it arrived', () => {
    expect(result.mapped[0].employee.joinDate).toBe('2020-07-01')
    expect(result.mapped[1].employee.joinDate).toBe('2021-03-15')
  })

  it('brings everyone in as Pending MD approval, per policy section 10', () => {
    expect(result.mapped.every((row) => row.employee.incentiveListStatus === 'Pending MD approval')).toBe(true)
  })

  it('never invents a probation flag — SuccessFactors has no such field on User', () => {
    expect(result.mapped.every((row) => row.employee.status === 'Active')).toBe(true)
  })

  it('warns about a missing joining date, because pro-rata depends on it', () => {
    expect(result.mapped[2].warnings.join(' ')).toContain('joining date')
  })
})

describe('records that cannot become an employee', () => {
  const base = { ...EMPTY_MAPPING, empId: 'userId', firstName: 'firstName' }
  const run = (users: Array<Record<string, unknown>>) => mapSapUsers(users, base)

  it('rejects one with no Emp ID', () => {
    expect(run([{ firstName: 'Nameless' }]).rejected[0].reason).toMatch(/No value/)
  })

  it('rejects a non-numeric Emp ID', () => {
    expect(run([{ userId: 'ABC123', firstName: 'X' }]).rejected[0].reason).toMatch(/not a number/)
  })

  it('rejects one with no name at all', () => {
    expect(run([{ userId: '40000001' }]).rejected[0].reason).toMatch(/No name/)
  })

  it('rejects the second of two records sharing an Emp ID', () => {
    const outcome = run([
      { userId: '40000001', firstName: 'First' },
      { userId: '40000001', firstName: 'Second' },
    ])
    expect(outcome.mapped).toHaveLength(1)
    expect(outcome.mapped[0].employee.name).toBe('First')
    expect(outcome.rejected[0].reason).toMatch(/more than once/)
  })

  it('falls back to a full name when there are no name parts', () => {
    const outcome = mapSapUsers(
      [{ userId: '40000001', defaultFullName: 'Solo Name' }],
      { ...base, firstName: '', fullName: 'defaultFullName' },
    )
    expect(outcome.mapped[0].employee.name).toBe('Solo Name')
  })
})

describe('mappingIsComplete gates the import button', () => {
  it('needs an Emp ID and some kind of name', () => {
    expect(mappingIsComplete(EMPTY_MAPPING)).toBe(false)
    expect(mappingIsComplete({ ...EMPTY_MAPPING, empId: 'userId' })).toBe(false)
    expect(mappingIsComplete({ ...EMPTY_MAPPING, empId: 'userId', firstName: 'firstName' })).toBe(true)
    expect(mappingIsComplete({ ...EMPTY_MAPPING, empId: 'userId', fullName: 'defaultFullName' })).toBe(true)
  })
})
