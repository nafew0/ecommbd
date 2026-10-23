import {MigrationInterface, QueryRunner} from "typeorm";

export class SalesPageOffer1792741320765 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsSalespageoffer" character varying(40)`, undefined);
        // Added by hand to the generated step: orders placed before this release were priced from
        // `salesPageId`. Editing a placed order re-runs promotions (Vendure's modifyOrder), so they
        // keep their offer only if the new field is copied for them. Open carts aren't copied: a
        // sales page's order form sets the field again on its next step, and a normal cart must
        // never get it (that was the bug).
        await queryRunner.query(`UPDATE "order" SET "customFieldsSalespageoffer" = "customFieldsSalespageid" WHERE "customFieldsSalespageid" IS NOT NULL AND "orderPlacedAt" IS NOT NULL`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsSalespageoffer"`, undefined);
   }

}
