import {MigrationInterface, QueryRunner} from "typeorm";

export class AddCostAndProfit1794685512826 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order_line" ADD "customFieldsUnitcost" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsUnitcost" integer`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsUnitcost"`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" DROP COLUMN "customFieldsUnitcost"`, undefined);
   }

}
