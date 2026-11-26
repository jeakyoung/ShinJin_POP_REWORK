package com.shinjin.pop.workorders;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import static com.shinjin.pop.workorders.WorkOrderFixtures.*;

final class ProductionMaterials {
    record Line(LocalDate date,int sequence,long revision,MaterialEvent event,BigDecimal available) {}
    record Patch(LocalDate date,int sequence,long revision,long event,BigDecimal quantity,MaterialSpec spec) {}
    record Draft(LocalDate date,int sequence,Action action,List<Patch> lines) {}
    record Command(String requestId,Action action,boolean remove,List<Patch> lines,List<EntryKey> visible) {}
    record Receipt(String worker,String focus,Command command,List<Line> result) {}
    private ProductionMaterials() {}
}
