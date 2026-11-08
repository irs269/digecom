import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveriesService } from './deliveries.service';
import { DeliveryJobs } from './delivery-jobs';
import { DevToolsController } from './dev-tools.controller';
import { OrderService } from './order.service';
import {
  CourierController,
  DeliveriesController,
  OrdersController,
  SellerOrdersController,
} from './orders.controller';

/** Commandes, livraisons par île, API livreur et vendeur (phase 3). */
@Module({
  imports: [AuthModule],
  controllers: [
    OrdersController,
    DeliveriesController,
    CourierController,
    SellerOrdersController,
    DevToolsController,
  ],
  providers: [OrderService, DeliveriesService, DeliveryJobs],
  exports: [OrderService, DeliveryJobs],
})
export class OrdersModule {}
