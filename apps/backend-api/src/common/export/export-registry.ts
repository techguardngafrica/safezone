import { Global, Injectable, Module } from '@nestjs/common';
import type { ExportRow } from './csv';

/** One dataset in an estate export (platform.md §6). Each module exports only its own tables. */
export interface ExportDataset {
  /** File name stem, e.g. `billing/invoices`. */
  name: string;
  rows(estateId: string): Promise<ExportRow[]>;
}

/** Modules register their datasets at start-up; the export job collects them. */
@Injectable()
export class EstateExportRegistry {
  private readonly datasets = new Map<string, ExportDataset>();

  register(...datasets: ExportDataset[]): void {
    for (const dataset of datasets) {
      if (this.datasets.has(dataset.name))
        throw new Error(`export dataset ${dataset.name} registered twice`);
      this.datasets.set(dataset.name, dataset);
    }
  }

  all(): ExportDataset[] {
    return [...this.datasets.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

@Global()
@Module({ providers: [EstateExportRegistry], exports: [EstateExportRegistry] })
export class ExportRegistryModule {}
