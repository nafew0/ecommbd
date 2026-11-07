import {MigrationInterface, QueryRunner} from "typeorm";

export class CacheSpeed1792691107113 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "cache_purge_request" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "tags" jsonb NOT NULL, "all" boolean NOT NULL DEFAULT false, "dueAt" TIMESTAMP NOT NULL, "boundary" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_71d244af57bc1bfc1a8a32d5106" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9a4b7905ab92a90a7cde027fcc" ON "cache_purge_request" ("channelId", "dueAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "cache_stock_state" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "variantId" integer NOT NULL, "available" boolean NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_7b93e4119bbe34e5782a379cb75" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d8377b179552398fb1d144f7ba" ON "cache_stock_state" ("channelId", "variantId") `, undefined);
        await queryRunner.query(`CREATE TABLE "cache_vital_sample" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "metricId" character varying(40) NOT NULL, "name" character varying(3) NOT NULL, "value" double precision NOT NULL, "route" character varying(16) NOT NULL, "day" date NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_b2fe623e021df6c2268044506bc" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5b8b9c660cdd1193bfd24504d2" ON "cache_vital_sample" ("channelId", "day") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5cd5b3050eb138d0244615c8eb" ON "cache_vital_sample" ("channelId", "metricId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_5cd5b3050eb138d0244615c8eb"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5b8b9c660cdd1193bfd24504d2"`, undefined);
        await queryRunner.query(`DROP TABLE "cache_vital_sample"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d8377b179552398fb1d144f7ba"`, undefined);
        await queryRunner.query(`DROP TABLE "cache_stock_state"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9a4b7905ab92a90a7cde027fcc"`, undefined);
        await queryRunner.query(`DROP TABLE "cache_purge_request"`, undefined);
   }

}
