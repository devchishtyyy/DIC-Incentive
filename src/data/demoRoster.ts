/**
 * The optional demo roster — 35 invented employees plus one waiting for MD approval.
 *
 * NOT part of the app's normal state. It is loaded only by "Load demo data", so the app
 * ships with no invented staff and the real SAP roster is the default. Several share a
 * first name on purpose: 6905/9360 and 6289/6290 in the real sheet were different people,
 * which is why Emp ID is always shown beside the name.
 */

import type { Employee } from '../domain/types'
import { DEFAULT_DEPARTMENT_ID } from './masters'
import { PLANT_POINTS, pointIdFor } from './plantMasters'

type EmployeeSeed = Omit<Employee, 'incentiveListStatus' | 'active'> &
  Partial<Pick<Employee, 'incentiveListStatus' | 'active'>>

const E = (
  empId: number,
  name: string,
  grade: string,
  site: Employee['site'],
  role: Employee['role'] = 'Operator',
  extra: Partial<EmployeeSeed> = {},
): Employee => ({
  empId,
  sapUserId: null,
  name,
  grade,
  site,
  role,
  status: 'Active',
  pointIds: [],
  departmentId: DEFAULT_DEPARTMENT_ID,
  outputNotMeasured: false,
  joinDate: '2023-04-01',
  leaveDate: null,
  incentiveListStatus: 'Approved',
  active: true,
  ...extra,
})

/**
 * 35 invented employees plus one addition waiting for MD approval. Several share a first name on purpose: 6905/9360 and 6289/6290 in the real
 * sheet were different people, which is why Emp ID is always shown beside the name.
 */
export const DEMO_EMPLOYEES: Employee[] = [
  // --- 20 ---
  E(4101, 'Adeel Farooq', 'Grade B', 'Kasur', 'Supervisor'),
  E(4102, 'Bilal Nawaz', 'Grade C', 'Kasur'),
  E(4103, 'Hamza Siddiqui', 'P1', 'Kasur'),
  E(4104, 'Usman Tariq', 'Grade 2', 'Kasur'),
  E(4105, 'Zeeshan Haider', 'TE2', 'Kasur'),
  E(4106, 'Faizan Mir', 'Grade A', 'Kasur'),
  E(4107, 'Nabeel Arshad', 'TE', 'Kasur'),
  E(4108, 'Tahir Mehmood', 'Grade C', 'Kasur'),
  E(4109, 'Tahir Abbas', 'Grade 1', 'Karachi'),
  E(4110, 'Shehzad Anwar', 'P2', 'Kasur', 'Supervisor'),
  E(4111, 'Shehzad Mehmood', 'Grade B', 'Kasur'),
  E(4112, 'Junaid Rafiq', 'TE3', 'Inplant'),
  E(4113, 'Waqar Ilyas', 'Grade 3', 'Kasur'),
  E(4114, 'Shoaib Akram', 'JE-1', 'Kasur'),
  E(4115, 'Asim Pervaiz', 'Grade A', 'Karachi'),
  E(4116, 'Rashid Mehboob', 'TE', 'Kasur', 'Operator', {
    status: 'Probation',
    joinDate: '2026-07-20',
  }),
  E(4117, 'Danish Qamar', 'Grade 2', 'Kasur'),
  E(4118, 'Noman Butt', 'P3', 'Kasur', 'Supervisor'),
  E(4119, 'Saad Zubair', 'Grade B', 'Kasur', 'Operator', { joinDate: '2026-09-01' }),
  E(4120, 'Irfan Jamil', 'TE4', 'Kasur', 'Operator', {
    status: 'Left',
    leaveDate: '2026-09-05',
  }),

  // --- 5 more ---
  E(4201, 'Kashif Riaz', 'Grade C', 'Kasur', 'Supervisor'),
  E(4202, 'Ahsan Malik', 'Grade 1', 'Kasur'),
  E(4203, 'Zohaib Nazir', 'TE2', 'Kasur', 'Operator', {
    status: 'Probation',
    joinDate: '2026-08-05',
  }),
  E(4204, 'Tanveer Aslam', 'P1', 'Karachi'),
  E(4205, 'Hassan Raza', 'Grade 3', 'Kasur'),

  // --- 10 more ---
  E(4301, 'Owais Bashir', 'P2', 'Karachi', 'Supervisor'),
  E(4302, 'Fahad Yousaf', 'Grade B', 'Karachi'),
  E(4303, 'Rizwan Sattar', 'TE3', 'Karachi'),
  E(4304, 'Mudassar Ali', 'Grade 2', 'Inplant'),
  E(4305, 'Arsalan Khalid', 'Grade A', 'Karachi'),
  E(4306, 'Haroon Zafar', 'JE-1', 'Karachi'),
  E(4307, 'Sajid Mehmood', 'TE', 'Inplant'),
  E(4308, 'Talha Ghafoor', 'Grade C', 'Karachi'),
  E(4309, 'Moazzam Iqbal', 'Grade 3', 'Karachi'),
  E(4310, 'Zubair Latif', 'TE4', 'Karachi'),

  // --- Waiting for MD approval (policy section 10) — excluded from the roll-up ---
  E(4999, 'Ibrahim Saeed', 'Grade B', 'Kasur', 'Operator', {
    joinDate: '2026-09-22',
    incentiveListStatus: 'Pending MD approval',
    requestedBy: 'U-ADM',
    requestedAt: '2026-09-23T05:30:00.000Z',
  }),
]

/**
 * Demo staff work the real Points, so the demo exercises the same path a real import does.
 */
const ALL_POINT_IDS = PLANT_POINTS.map(pointIdFor)

DEMO_EMPLOYEES.forEach((employee, index) => {
  const first = index % ALL_POINT_IDS.length
  const second = (first + 7) % ALL_POINT_IDS.length
  employee.pointIds = first === second ? [ALL_POINT_IDS[first]] : [ALL_POINT_IDS[first], ALL_POINT_IDS[second]]
})
