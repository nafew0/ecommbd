import {MigrationInterface, QueryRunner} from "typeorm";

export class Couriers1792831273423 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_courier_booking" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "orderId" integer NOT NULL, "activeKey" character varying(20), "courier" character varying(16) NOT NULL, "mode" character varying(8) NOT NULL, "status" character varying(12) NOT NULL, "consignmentId" character varying(60), "trackingCode" character varying(60), "codAmount" integer NOT NULL, "weightGrams" integer, "deliveryFee" integer, "outcome" character varying(20) NOT NULL DEFAULT 'booked', "courierStatus" character varying(60), "statusAt" TIMESTAMP(6), "outcomeAt" TIMESTAMP(6), "errorCode" character varying(40), "errorMessage" character varying(500), "bookedBy" character varying(120), "nextPollAt" TIMESTAMP(6), "events" jsonb NOT NULL DEFAULT '[]', "id" SERIAL NOT NULL, CONSTRAINT "PK_b60c65f56b98e34ab86a655ba9a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6b076d6390538200f902f34adc" ON "bd_courier_booking" ("orderId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c5cfce035f98db4051868527fc" ON "bd_courier_booking" ("activeKey") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_aefb9336de579cf31e17210f0b" ON "bd_courier_booking" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_9bab204d9e392770e6583677aa" ON "bd_courier_booking" ("consignmentId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f0006b8163e6753098b90db92a" ON "bd_courier_booking" ("outcome") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d556eb49c5514cc8ec4a2f8edd" ON "bd_courier_booking" ("outcomeAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_59923ee85667bc3d99c75f66ea" ON "bd_courier_booking" ("nextPollAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_courier_location" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courier" character varying(16) NOT NULL, "kind" character varying(8) NOT NULL, "externalId" integer NOT NULL, "parentId" integer, "name" character varying(120) NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "UQ_6d2d2af06227406ed42159a0a8e" UNIQUE ("courier", "kind", "externalId"), CONSTRAINT "PK_10ba421c37d8a62dd168f206577" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_2cd8d75fad9fae4bf983907fd2" ON "bd_courier_location" ("kind") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7ac7433766c99ff16daca90f17" ON "bd_courier_location" ("parentId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_courier_location_map" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "courier" character varying(16) NOT NULL, "districtId" character varying(20) NOT NULL, "thanaId" character varying(20) NOT NULL, "cityId" integer NOT NULL, "zoneId" integer NOT NULL, "areaId" integer, "source" character varying(8) NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "UQ_294b91f030ec873063bb73871f4" UNIQUE ("courier", "districtId", "thanaId"), CONSTRAINT "PK_5a9110be238fca3811478cecc17" PRIMARY KEY ("id"))`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP TABLE "bd_courier_location_map"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7ac7433766c99ff16daca90f17"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_2cd8d75fad9fae4bf983907fd2"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_courier_location"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_59923ee85667bc3d99c75f66ea"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d556eb49c5514cc8ec4a2f8edd"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f0006b8163e6753098b90db92a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9bab204d9e392770e6583677aa"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_aefb9336de579cf31e17210f0b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c5cfce035f98db4051868527fc"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b076d6390538200f902f34adc"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_courier_booking"`, undefined);
   }

}
