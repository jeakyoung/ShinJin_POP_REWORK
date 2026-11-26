import com.shinjin.pop.output.DemoReportPrinter;
import com.shinjin.pop.output.DemoReportPrinter.*;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;

public final class ReportPrinterCheck {
    static void require(boolean ok) {
        if (!ok) throw new AssertionError();
    }

    public static void main(String[] args) {
        var submitted = new ArrayList<PrintCall>();
        var printer = new DemoReportPrinter(submitted::add);
        var devices = new Devices("synthetic-desk", "synthetic-dispatch");
        for (var form : ManualForm.values()) {
            String expected = form == ManualForm.SHIPPING_STATEMENT ? devices.printer2() : devices.printer1();
            var preview = printer.openPreview(devices, form, 3);
            require(preview.device().equals(expected) && preview.documentPages() == 3);
            require(submitted.isEmpty()); // closing a preview without printing produces no job
            preview = printer.openPreview(devices, form, 3);
            printer.printFromPreview(preview, OptionalInt.of(2));
            require(submitted.equals(List.of(new PrintCall(expected, 3, OptionalInt.of(2)))));
            submitted.clear();
        }
        for (var action : ShippingAction.values()) {
            for (var delivery : Delivery.values()) {
                boolean prints = delivery == Delivery.PAPER_AND_EMAIL
                        || (action == ShippingAction.AUTO_PRINT && delivery == Delivery.PAPER);
                var result = printer.shippingSaved(devices, action, List.of(new ShippingPages(delivery, 3)));
                var expected = new PrintCall(devices.printer2(), 3, OptionalInt.empty());
                require(result.isPresent() == prints);
                require(submitted.equals(prints ? List.of(expected) : List.of()));
                submitted.clear();
                require(printer.shippingSaved(devices, action, List.of(new ShippingPages(delivery, 0))).isEmpty());
                require(submitted.isEmpty());
            }
        }
        printer.shippingSaved(devices, ShippingAction.AUTO_PRINT, List.of(new ShippingPages(Delivery.EMAIL, 4),
                new ShippingPages(Delivery.PAPER, 1), new ShippingPages(Delivery.PAPER_AND_EMAIL, 2)));
        require(submitted.equals(List.of(new PrintCall(devices.printer2(), 3, OptionalInt.empty()))));
        var unset = printer.openPreview(new Devices("", devices.printer2()), ManualForm.EMPLOYEE_QR, 1);
        require(unset.device().isEmpty());
        System.out.println("PASS manual preview/device/copies/close (4 forms), automatic routing (6 combinations),"
                + " empty pages (6 combinations), merged submission and unassigned slot");
    }
}
