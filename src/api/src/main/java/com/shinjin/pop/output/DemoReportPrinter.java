package com.shinjin.pop.output;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalInt;

/** Models the POP report calls without binding an OS print service. */
public final class DemoReportPrinter {
    public record Devices(String printer1, String printer2) {}
    public enum ManualForm { EMPLOYEE_BARCODE, EMPLOYEE_QR, WORK_ORDER, SHIPPING_STATEMENT }
    public enum Delivery { PAPER, EMAIL, PAPER_AND_EMAIL }
    public enum ShippingAction { AUTO_PRINT, AUTO_EMAIL }

    /** Pages already rendered for one delivery setting within one shipping number. */
    public record ShippingPages(Delivery delivery, int pages) {
        public ShippingPages {
            Objects.requireNonNull(delivery);
            if (pages < 0) throw new IllegalArgumentException("negative page count");
        }
    }

    // Empty copies means the call site supplied no copy override to the device.
    public record PrintCall(String device, int documentPages, OptionalInt copies) {}
    public record Preview(ManualForm form, String device, int documentPages) {}

    @FunctionalInterface
    public interface SyntheticSpool {
        void submit(PrintCall call);
    }

    private final SyntheticSpool spool;

    public DemoReportPrinter(SyntheticSpool spool) {
        this.spool = Objects.requireNonNull(spool);
    }

    public Preview openPreview(Devices devices, ManualForm form, int documentPages) {
        Objects.requireNonNull(form);
        if (documentPages < 0) throw new IllegalArgumentException("negative page count");
        String device = form == ManualForm.SHIPPING_STATEMENT ? devices.printer2() : devices.printer1();
        return new Preview(form, device, documentPages);
    }

    public void printFromPreview(Preview preview, OptionalInt copies) {
        if (copies.isPresent() && copies.getAsInt() <= 0) throw new IllegalArgumentException("invalid copies");
        spool.submit(new PrintCall(preview.device(), preview.documentPages(), copies));
    }

    /** Called once per shipping number after save; input pages include all generated reports. */
    public Optional<PrintCall> shippingSaved(Devices devices, ShippingAction action, List<ShippingPages> reports) {
        Objects.requireNonNull(action);
        int pages = 0;
        for (ShippingPages report : reports) {
            if (report.delivery() == Delivery.PAPER_AND_EMAIL
                    || (action == ShippingAction.AUTO_PRINT && report.delivery() == Delivery.PAPER)) {
                pages = Math.addExact(pages, report.pages());
            }
        }
        if (pages == 0) return Optional.empty();
        var call = new PrintCall(devices.printer2(), pages, OptionalInt.empty());
        spool.submit(call);
        return Optional.of(call);
    }
}
