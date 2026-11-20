import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { OccupancyModule } from '../occupancy/occupancy.module';
import { PropertyModule } from '../property/property.module';
import { VisitorModule } from '../visitor/visitor.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Estate-wide global search (ADR-0021). Owns no tables: each owning module answers its part of the query
 * inside one tenant transaction. Moved out of tenancy, which every one of those modules imports.
 */
@Module({
  imports: [PropertyModule, OccupancyModule, VisitorModule, BillingModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
