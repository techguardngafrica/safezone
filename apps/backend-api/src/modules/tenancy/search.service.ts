import { Injectable } from '@nestjs/common';
import type { globalSearchHitSchema, globalSearchQuerySchema } from '@safezone/schemas';
import type { z } from 'zod';
import type { EstateAccess } from '../../common/auth/auth.decorators';
import { DatabaseService } from '../../common/database/database.service';

type Hit = z.infer<typeof globalSearchHitSchema>;

/**
 * Estate-wide global search (management-web.md §5).
 * Spaces are visible to every member (as in the spaces list). People, plates, passes and invoices are
 * estate-wide data, so they need the permission through a staff role: a resident's own `invoice.read`
 * covers only their household and must never list other households' invoices here.
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(access: EstateAccess, query: z.infer<typeof globalSearchQuerySchema>) {
    const q = query.q.trim();
    const take = query.limit;
    const hits: Hit[] = [];
    const staff = access.staffPermissions ?? new Set<string>();

    await this.db.withTenant(access, async (tx) => {
      // 1. Spaces / units (all estate members)
      const spaces = await tx.space.findMany({
        where: {
          estateId: access.estateId,
          archivedAt: null,
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        },
        take,
        orderBy: { code: 'asc' },
      });
      for (const s of spaces) {
        hits.push({
          kind: 'space',
          id: s.id,
          title: `${s.code} - ${s.name}`,
          subtitle: s.unitType ?? s.type,
          href: `/${access.estateId}/estate/spaces`,
        });
      }

      // 2. Residents / household members (staff resident.read)
      if (staff.has('resident.read')) {
        const members = await tx.householdMember.findMany({
          where: {
            estateId: access.estateId,
            status: 'active',
            fullName: { contains: q, mode: 'insensitive' },
          },
          include: { household: { select: { name: true } } },
          take,
          orderBy: { fullName: 'asc' },
        });
        for (const m of members) {
          hits.push({
            kind: 'resident',
            id: m.id,
            title: m.fullName,
            subtitle: m.household.name,
            href: `/${access.estateId}/people/residents`,
          });
        }
      }

      // 3. Vehicles / plates (resident.read or visitor.log.read)
      if (staff.has('resident.read') || staff.has('visitor.log.read')) {
        const vehicles = await tx.vehicle.findMany({
          where: {
            estateId: access.estateId,
            status: 'active',
            OR: [
              { plateNormalised: { contains: q.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() } },
              { plateDisplay: { contains: q, mode: 'insensitive' } },
            ],
          },
          take,
          orderBy: { createdAt: 'desc' },
        });
        for (const v of vehicles) {
          hits.push({
            kind: 'vehicle',
            id: v.id,
            title: v.plateDisplay,
            subtitle: [v.make, v.model, v.colour].filter(Boolean).join(' ') || null,
            href: `/${access.estateId}/people/households`,
          });
        }
      }

      // 4. Visitor passes (visitor.log.read)
      if (staff.has('visitor.log.read')) {
        const passes = await tx.visitorPass.findMany({
          where: {
            estateId: access.estateId,
            OR: [
              { visitorName: { contains: q, mode: 'insensitive' } },
              { vehiclePlate: { contains: q, mode: 'insensitive' } },
            ],
          },
          take,
          orderBy: { createdAt: 'desc' },
        });
        for (const p of passes) {
          hits.push({
            kind: 'pass',
            id: p.id,
            title: p.visitorName,
            subtitle: p.vehiclePlate ?? (p.revokedAt ? 'revoked' : 'active'),
            href: `/${access.estateId}/security/passes`,
          });
        }
      }

      // 5. Invoices (staff invoice.read)
      if (staff.has('invoice.read')) {
        const invoices = await tx.invoice.findMany({
          where: {
            estateId: access.estateId,
            number: { contains: q, mode: 'insensitive' },
          },
          take,
          orderBy: { createdAt: 'desc' },
        });
        for (const inv of invoices) {
          hits.push({
            kind: 'invoice',
            id: inv.id,
            title: inv.number,
            subtitle: inv.status,
            href: `/${access.estateId}/finance/invoices`,
          });
        }
      }
    });

    return { query: q, hits };
  }
}
