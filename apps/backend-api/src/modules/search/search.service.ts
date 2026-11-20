import { Injectable } from '@nestjs/common';
import type { globalSearchHitSchema, globalSearchQuerySchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';
import { InvoicesService } from '../billing/invoices.service';
import { OccupancyService } from '../occupancy/occupancy.service';
import { PropertyService } from '../property/property.service';
import { PassesService } from '../visitor/passes.service';

type Hit = z.infer<typeof globalSearchHitSchema>;

/**
 * Estate-wide global search (management-web.md §5).
 * Spaces are visible to every member (as in the spaces list). People, plates, passes and invoices are
 * estate-wide data, so they need the permission through a staff role: a resident's own `invoice.read`
 * covers only their household and must never list other households' invoices here.
 * Each owning module runs its own query (AGENTS.md §5.1) inside this one tenant transaction.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly property: PropertyService,
    private readonly occupancy: OccupancyService,
    private readonly passes: PassesService,
    private readonly invoices: InvoicesService,
  ) {}

  async search(access: EstateAccess, query: z.infer<typeof globalSearchQuerySchema>) {
    const q = query.q.trim();
    const take = query.limit;
    const hits: Hit[] = [];
    const staff = access.staffPermissions ?? new Set<string>();
    const { estateId } = access;

    await this.db.withTenant(access, async (tx) => {
      // 1. Spaces / units (all estate members)
      for (const s of await this.property.searchSpaces(tx, estateId, q, take)) {
        hits.push({
          kind: 'space',
          id: s.id,
          title: `${s.code} - ${s.name}`,
          subtitle: s.unitType ?? s.type,
          href: `/${estateId}/estate/spaces`,
        });
      }

      // 2. Residents / household members (staff resident.read)
      if (staff.has('resident.read')) {
        for (const m of await this.occupancy.searchMembers(tx, estateId, q, take)) {
          hits.push({
            kind: 'resident',
            id: m.id,
            title: m.fullName,
            subtitle: m.householdName,
            href: `/${estateId}/people/residents`,
          });
        }
      }

      // 3. Vehicles / plates (resident.read or visitor.log.read)
      if (staff.has('resident.read') || staff.has('visitor.log.read')) {
        for (const v of await this.occupancy.searchVehicles(tx, estateId, q, take)) {
          hits.push({
            kind: 'vehicle',
            id: v.id,
            title: v.plateDisplay,
            subtitle: [v.make, v.model, v.colour].filter(Boolean).join(' ') || null,
            href: `/${estateId}/people/households`,
          });
        }
      }

      // 4. Visitor passes (visitor.log.read)
      if (staff.has('visitor.log.read')) {
        for (const p of await this.passes.searchPasses(tx, estateId, q, take)) {
          hits.push({
            kind: 'pass',
            id: p.id,
            title: p.visitorName,
            subtitle: p.vehiclePlate ?? (p.revokedAt ? 'revoked' : 'active'),
            href: `/${estateId}/security/passes`,
          });
        }
      }

      // 5. Invoices (staff invoice.read)
      if (staff.has('invoice.read')) {
        for (const inv of await this.invoices.searchInvoices(tx, estateId, q, take)) {
          hits.push({
            kind: 'invoice',
            id: inv.id,
            title: inv.number,
            subtitle: inv.status,
            href: `/${estateId}/finance/invoices`,
          });
        }
      }
    });

    return { query: q, hits };
  }
}
