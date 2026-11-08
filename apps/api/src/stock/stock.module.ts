import { Global, Module } from '@nestjs/common';
import { CatalogController } from '../catalog/catalog.controller';
import { ProductsService } from '../catalog/products.service';
import { PurchasesController } from '../purchases/purchases.controller';
import { PurchasesService } from '../purchases/purchases.service';
import { CounterService } from './counter.service';
import { InventoryService } from './inventory.service';
import { StockAlertsScheduler } from './stock-alerts.scheduler';
import { StockQueryService } from './stock-query.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/** Catalogues, stock par site, achats en Chine (phase 2). StockService est exporté pour les commandes. */
@Global()
@Module({
  controllers: [CatalogController, StockController, PurchasesController],
  providers: [
    CounterService,
    StockService,
    StockQueryService,
    InventoryService,
    StockAlertsScheduler,
    ProductsService,
    PurchasesService,
  ],
  exports: [CounterService, StockService, StockQueryService, ProductsService],
})
export class StockModule {}
